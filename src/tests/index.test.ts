import { readdirSync } from "fs"
import { join } from "path";
import { ConfigBuilder } from "../config"

describe('Config files', () => {
	test('should all be valid', () => {
		const files = readdirSync(join(__dirname, "/../../examples"));
		for (const file of files) {
			const rawConfig = ConfigBuilder.loadConfig(join(__dirname, "/../../examples", file));
			ConfigBuilder.verifyConfig(rawConfig);
		}
	});
});
