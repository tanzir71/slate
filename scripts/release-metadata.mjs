/** @param {{ version: string, appVersion: string, notesVersion: string }} metadata @param {string | undefined} tag */
export function assertReleaseMetadata({ version, appVersion, notesVersion }, tag) {
  if (version !== appVersion || version !== notesVersion) {
    throw new Error(`Release versions disagree: root ${version}, app ${appVersion}, notes ${notesVersion}`);
  }
  if (tag !== undefined && tag !== `v${version}`) {
    throw new Error(`Release tag ${tag} must match v${version}`);
  }
}
