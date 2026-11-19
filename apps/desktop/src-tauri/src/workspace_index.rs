use serde::Deserialize;
use sqlx::SqlitePool;

const DATABASE: &str = "sqlite:slate-index.sqlite";
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
    state: tauri::State<'_, tauri_plugin_sql::DbInstances>,
    rows: Vec<IndexRow>,
) -> Result<(), String> {
    let pool = {
        let databases = state.0.read().await;
        match databases.get(DATABASE) {
            Some(tauri_plugin_sql::DbPool::Sqlite(pool)) => pool.clone(),
            _ => return Err("The workspace search cache is not open".into()),
        }
    };
    replace(&pool, rows)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
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
            sqlx::query("CREATE TABLE sheets (id TEXT, path TEXT PRIMARY KEY, title TEXT, body TEXT, tags_json TEXT, links_json TEXT, words INTEGER, updated_at TEXT, content_hash TEXT)").execute(&pool).await.unwrap();
            sqlx::query("CREATE VIRTUAL TABLE sheets_fts USING fts5(path, title, body, tags)")
                .execute(&pool)
                .await
                .unwrap();
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
}
