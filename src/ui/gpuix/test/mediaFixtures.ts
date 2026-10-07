import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureFixture, type FixtureName } from "../../../video-editor/media/node/testing/mediaFixtures";

// Generated media fixtures are cached under the gitignored <repo>/tmp.
const FIXTURE_DIRECTORY = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../../tmp/media-fixtures/v1",
);

export const gpuixFixture = (name: FixtureName): Promise<string> =>
	ensureFixture(name, { directory: FIXTURE_DIRECTORY });
