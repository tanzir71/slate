use crate::workspace::FileError;
use serde::Deserialize;
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Default)]
pub struct WorkspaceIndex {
    pools: tauri::async_runtime::Mutex<std::collections::BTreeMap<String, SqlitePool>>,
}

fn cache_path(root: &Path) -> Result<PathBuf, FileError> {
    std::fs::create_dir_all(root).map_err(FileError::io)?;
    let root = std::fs::canonicalize(root).map_err(FileError::io)?;
    let target = root.join("slate-index.sqlite");
    for name in [
        "slate-index.sqlite",
        "slate-index.sqlite-wal",
        "slate-index.sqlite-shm",
    ] {
        match std::fs::symlink_metadata(root.join(name)) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                return Err(slate_core::StorageError::PathEscapesRoot.into())
            }
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                return Err(FileError::io(error))
            }
            _ => {}
        }
    }
    Ok(target)
}

async fn schema(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query("CREATE TABLE IF NOT EXISTS sheets (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, title TEXT NOT NULL, body TEXT NOT NULL, tags_json TEXT NOT NULL, links_json TEXT NOT NULL, words INTEGER NOT NULL, updated_at TEXT, content_hash TEXT NOT NULL)")
        .execute(pool).await?;
    sqlx::query("CREATE VIRTUAL TABLE IF NOT EXISTS sheets_fts USING fts5(path UNINDEXED, title, body, tags)")
        .execute(pool).await?;
    Ok(())
}

fn space_cache_root(base: &Path, id: &str) -> Result<PathBuf, FileError> {
    std::fs::create_dir_all(base).map_err(FileError::io)?;
    let base = std::fs::canonicalize(base).map_err(FileError::io)?;
    if id == crate::spaces::DEFAULT_ID {
        return Ok(base);
    }
    if !uuid::Uuid::parse_str(id).is_ok_and(|value| value.to_string() == id) {
        return Err(slate_core::StorageError::PathEscapesRoot.into());
    }
    let mut root = base;
    for part in ["spaces", id] {
        root.push(part);
        match std::fs::create_dir(&root) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(FileError::io(error)),
        }
        let metadata = std::fs::symlink_metadata(&root).map_err(FileError::io)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(slate_core::StorageError::PathEscapesRoot.into());
        }
    }
    Ok(root)
}
async fn pool(
    app: &tauri::AppHandle,
    state: &WorkspaceIndex,
    space_id: Option<&str>,
) -> Result<SqlitePool, FileError> {
    // Admission uses the same opened-root registry as IO; the ID never becomes a path argument.
    crate::spaces::resolve(app, space_id)?;
    let id = space_id.unwrap_or(crate::spaces::DEFAULT_ID);
    let mut cache = state.pools.lock().await;
    if let Some(pool) = cache.get(id) {
        return Ok(pool.clone());
    }
    let root = app.path().app_cache_dir().map_err(FileError::io)?;
    let captured_id = id.to_owned();
    let path = tauri::async_runtime::spawn_blocking(move || {
        cache_path(&space_cache_root(&root, &captured_id)?)
    })
    .await
    .map_err(FileError::io)??;
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(FileError::io)?;
    schema(&pool).await.map_err(FileError::io)?;
    cache.insert(id.to_owned(), pool.clone());
    Ok(pool)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexRow {
    entry: IndexEntry,
    body: String,
    content_hash: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexEntry {
    id: String,
    path: String,
    title: String,
    tags: Vec<String>,
    links: Vec<String>,
    words: u64,
    updated_at: Option<String>,
}

async fn replace(pool: &SqlitePool, rows: Vec<IndexRow>) -> Result<(), sqlx::Error> {
    let mut transaction = pool.begin().await?;
    sqlx::query("DELETE FROM sheets_fts")
        .execute(&mut *transaction)
        .await?;
    sqlx::query("DELETE FROM sheets")
        .execute(&mut *transaction)
        .await?;
    for row in rows {
        let entry = row.entry;
        sqlx::query("INSERT INTO sheets (id, path, title, body, tags_json, links_json, words, updated_at, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(&entry.id).bind(&entry.path).bind(&entry.title).bind(&row.body)
            .bind(serde_json::to_string(&entry.tags).expect("string array"))
            .bind(serde_json::to_string(&entry.links).expect("string array"))
            .bind(i64::try_from(entry.words).unwrap_or(i64::MAX)).bind(&entry.updated_at).bind(&row.content_hash)
            .execute(&mut *transaction).await?;
        sqlx::query("INSERT INTO sheets_fts (path, title, body, tags) VALUES (?, ?, ?, ?)")
            .bind(&entry.path)
            .bind(&entry.title)
            .bind(&row.body)
            .bind(entry.tags.join(" "))
            .execute(&mut *transaction)
            .await?;
    }
    transaction.commit().await
}

#[tauri::command]
pub async fn replace_workspace_index(
    app: tauri::AppHandle,
    state: tauri::State<'_, WorkspaceIndex>,
    space_id: Option<String>,
    rows: Vec<IndexRow>,
) -> Result<(), FileError> {
    let pool = pool(&app, &state, space_id.as_deref()).await?;
    replace(&pool, rows).await.map_err(FileError::io)
}

fn fts_query(query: &str) -> String {
    let terms: Vec<_> = query
        .split(|character: char| !character.is_ascii_alphanumeric() && !"_/.-".contains(character))
        .map(|term| term.trim_matches('/'))
        .filter(|term| !term.is_empty())
        .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
        .collect();
    if terms.is_empty() {
        format!("\"{}\"", query.replace('"', "\"\""))
    } else {
        terms.join(" ")
    }
}

async fn search(pool: &SqlitePool, query: &str) -> Result<Vec<String>, sqlx::Error> {
    let query = query.trim();
    if query.is_empty() {
        return sqlx::query_scalar("SELECT path FROM sheets ORDER BY path ASC")
            .fetch_all(pool)
            .await;
    }
    sqlx::query_scalar("SELECT sheets.path FROM sheets_fts JOIN sheets ON sheets.path = sheets_fts.path WHERE sheets_fts MATCH ? ORDER BY bm25(sheets_fts), sheets.path ASC")
        .bind(fts_query(query)).fetch_all(pool).await
}

#[tauri::command]
pub async fn search_workspace_index(
    app: tauri::AppHandle,
    state: tauri::State<'_, WorkspaceIndex>,
    space_id: Option<String>,
    query: String,
) -> Result<Vec<String>, FileError> {
    search(&pool(&app, &state, space_id.as_deref()).await?, &query)
        .await
        .map_err(FileError::io)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn space_caches_keep_identical_paths_in_independent_databases() {
        let base = std::env::temp_dir().join(format!("slate-space-cache-{}", uuid::Uuid::new_v4()));
        tauri::async_runtime::block_on(async {
            let first_id = uuid::Uuid::new_v4().to_string();
            let second_id = uuid::Uuid::new_v4().to_string();
            let first_path = cache_path(&space_cache_root(&base, &first_id).unwrap()).unwrap();
            let second_path = cache_path(&space_cache_root(&base, &second_id).unwrap()).unwrap();
            assert_ne!(first_path, second_path);
            assert_eq!(
                space_cache_root(&base, crate::spaces::DEFAULT_ID).unwrap(),
                std::fs::canonicalize(&base).unwrap()
            );
            let options = |path| {
                sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(path)
                    .create_if_missing(true)
            };
            let first = SqlitePool::connect_with(options(first_path)).await.unwrap();
            let second = SqlitePool::connect_with(options(second_path))
                .await
                .unwrap();
            schema(&first).await.unwrap();
            schema(&second).await.unwrap();
            replace(&first, vec![row("same.md", "First unique words")])
                .await
                .unwrap();
            replace(&second, vec![row("same.md", "Second other words")])
                .await
                .unwrap();
            assert_eq!(search(&first, "unique").await.unwrap(), vec!["same.md"]);
            assert!(search(&second, "unique").await.unwrap().is_empty());
            replace(&first, vec![]).await.unwrap();
            assert_eq!(search(&second, "other").await.unwrap(), vec!["same.md"]);
            first.close().await;
            second.close().await;
        });
        assert_eq!(base.parent(), Some(std::env::temp_dir().as_path()));
        std::fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn cache_names_cannot_escape_and_existing_non_directory_names_are_kept() {
        let base = std::env::temp_dir().join(format!("slate-space-cache-{}", uuid::Uuid::new_v4()));
        for id in ["../escape", "C:/root", "arbitrary", "../native-default"] {
            assert!(space_cache_root(&base, id).is_err());
        }
        let id = uuid::Uuid::new_v4().to_string();
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(base.join("spaces"), b"Keep this file").unwrap();
        assert!(space_cache_root(&base, &id).is_err());
        assert_eq!(
            std::fs::read(base.join("spaces")).unwrap(),
            b"Keep this file"
        );
        assert_eq!(base.parent(), Some(std::env::temp_dir().as_path()));
        std::fs::remove_dir_all(base).unwrap();
    }
    fn row(path: &str, body: &str) -> IndexRow {
        IndexRow {
            entry: IndexEntry {
                id: path.into(),
                path: path.into(),
                title: "Title".into(),
                tags: vec!["draft".into()],
                links: vec![],
                words: 2,
                updated_at: None,
            },
            body: body.into(),
            content_hash: "hash".into(),
        }
    }
    #[test]
    fn replacement_is_one_transaction_and_failure_keeps_both_old_tables() {
        tauri::async_runtime::block_on(async {
            let pool = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(5)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            schema(&pool).await.unwrap();
            replace(&pool, vec![row("original.md", "Original words")])
                .await
                .unwrap();
            assert!(replace(
                &pool,
                vec![row("duplicate.md", "one"), row("duplicate.md", "two")]
            )
            .await
            .is_err());
            assert_eq!(
                sqlx::query_scalar::<_, String>("SELECT path FROM sheets")
                    .fetch_all(&pool)
                    .await
                    .unwrap(),
                vec!["original.md"]
            );
            assert_eq!(
                sqlx::query_scalar::<_, String>(
                    "SELECT path FROM sheets_fts WHERE sheets_fts MATCH ?"
                )
                .bind("Original")
                .fetch_all(&pool)
                .await
                .unwrap(),
                vec!["original.md"]
            );
            let literal = "Text'); DROP TABLE sheets; --";
            replace(&pool, vec![row("new.md", literal)]).await.unwrap();
            assert_eq!(
                sqlx::query_scalar::<_, String>("SELECT body FROM sheets")
                    .fetch_one(&pool)
                    .await
                    .unwrap(),
                literal
            );
            replace(&pool, vec![]).await.unwrap();
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT count(*) FROM sheets_fts")
                    .fetch_one(&pool)
                    .await
                    .unwrap(),
                0
            );
            pool.close().await;
        });
    }

    #[test]
    fn search_is_literal_and_rebuild_removes_deleted_rows() {
        tauri::async_runtime::block_on(async {
            let pool = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            schema(&pool).await.unwrap();
            replace(
                &pool,
                vec![row("red.md", "red words"), row("blue.md", "blue বাংলা")],
            )
            .await
            .unwrap();
            assert_eq!(search(&pool, "red").await.unwrap(), vec!["red.md"]);
            assert_eq!(search(&pool, "বাংলা").await.unwrap(), vec!["blue.md"]);
            assert!(search(&pool, "red OR blue").await.unwrap().is_empty());
            assert!(search(&pool, "'); DROP TABLE sheets; --")
                .await
                .unwrap()
                .is_empty());
            assert_eq!(search(&pool, "").await.unwrap(), vec!["blue.md", "red.md"]);
            assert_eq!(search(&pool, "#draft").await.unwrap().len(), 2);
            replace(&pool, vec![row("new.md", "new words")])
                .await
                .unwrap();
            assert!(search(&pool, "red").await.unwrap().is_empty());
            assert_eq!(search(&pool, "new").await.unwrap(), vec!["new.md"]);
            pool.close().await;
        });
    }

    #[test]
    fn cache_files_are_fixed_and_directories_cannot_be_used_as_database_files() {
        let root = std::env::temp_dir().join(format!(
            "slate-cache-path-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let target = cache_path(&root).unwrap();
        assert_eq!(
            target,
            std::fs::canonicalize(&root)
                .unwrap()
                .join("slate-index.sqlite")
        );
        std::fs::create_dir(&target).unwrap();
        std::fs::write(target.join("keep"), b"Existing bytes").unwrap();
        let result = cache_path(&root);
        assert_eq!(root.parent(), Some(std::env::temp_dir().as_path()));
        let kept = std::fs::read(target.join("keep")).unwrap();
        std::fs::remove_dir_all(root).unwrap();
        assert_eq!(
            serde_json::to_value(result.unwrap_err()).unwrap()["kind"],
            "invalid-path"
        );
        assert_eq!(kept, b"Existing bytes");
    }
}
