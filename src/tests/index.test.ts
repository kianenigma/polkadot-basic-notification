import { readdirSync, readFileSync } from "fs"
import { join } from "path";
import { ConfigBuilder } from "../config"

const mockProcessExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
	throw new Error(`Process.exit(${code})`);
});

describe('Config files', () => {
	beforeEach(() => {
		mockProcessExit.mockClear();
	});

	it('should all be valid', () => {
		const files = readdirSync(join(__dirname, "/../../examples"));
		for (const file of files) {
			const rawConfig = ConfigBuilder.loadConfig(join(__dirname, "/../../examples", file));
			ConfigBuilder.verifyConfig(rawConfig);
		}
	});

	it('should catch invalid address', () => {
		const badConfig = JSON.parse(readFileSync(join(__dirname, "../../examples/config-dev-all.json")).toString());
		badConfig["accounts"][0]["address"] = "KIAN";
		expect(() => ConfigBuilder.verifyConfig(badConfig)).toThrowError();
	})

	it('should catch invalid method subscription', () => {
		const badConfig = JSON.parse(readFileSync(join(__dirname, "../../examples/config-dev-all.json")).toString());
		badConfig["method_subscription"] = 'all';
		expect(() => ConfigBuilder.verifyConfig(badConfig)).toThrowError();

		badConfig["method_subscription"] = 'foo';
		expect(() => ConfigBuilder.verifyConfig(badConfig)).toThrowError();

		badConfig["method_subscription"] = 'only: {}';
		expect(() => ConfigBuilder.verifyConfig(badConfig)).toThrowError();
	})

	it('should catch missing filed', () => {
		let badConfig = JSON.parse(readFileSync(join(__dirname, "../../examples/config-dev-all.json")).toString());
		delete badConfig['accounts']
		expect(() => ConfigBuilder.verifyConfig(badConfig)).toThrowError();

		badConfig = JSON.parse(readFileSync(join(__dirname, "../../examples/config-dev-all.json")).toString());
		delete badConfig['method_subscription']
		expect(() => ConfigBuilder.verifyConfig(badConfig)).toThrowError();

		badConfig = JSON.parse(readFileSync(join(__dirname, "../../examples/config-dev-all.json")).toString());
		delete badConfig['api_subscription']
		expect(() => ConfigBuilder.verifyConfig(badConfig)).toThrowError();

		badConfig = JSON.parse(readFileSync(join(__dirname, "../../examples/config-dev-all.json")).toString());
		delete badConfig['reporters']
		expect(() => ConfigBuilder.verifyConfig(badConfig)).toThrowError();
	})
});
