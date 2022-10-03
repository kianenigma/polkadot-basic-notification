import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ConfigBuilder } from '../config';
import { ConsoleReporter, FileSystemReporter, StartupReport } from '../reporters';
import { BatchReporter, SEPARATOR } from '../reporters/console';

const mockProcessExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
	throw new Error(`Process.exit(${code})`);
});

describe('Config files', () => {
	beforeEach(() => {
		mockProcessExit.mockClear();
	});

	it('should all be valid', () => {
		const files = readdirSync(join(__dirname, '/../../examples'));
		for (const file of files) {
			const rawConfig = ConfigBuilder.loadConfig(join(__dirname, '/../../examples', file));
			ConfigBuilder.verifyConfig(rawConfig);
		}
	});

	it('should catch invalid address', () => {
		const badConfig = JSON.parse(
			readFileSync(join(__dirname, '../../examples/config-dev-all.json')).toString()
		);
		badConfig['accounts'][0]['address'] = 'KIAN';
		expect(() => ConfigBuilder.verifyConfig(badConfig)).toThrowError();
	});

	it('should catch invalid method subscription', () => {
		const badConfig = JSON.parse(
			readFileSync(join(__dirname, '../../examples/config-dev-all.json')).toString()
		);
		badConfig['method_subscription'] = 'all';
		expect(() => ConfigBuilder.verifyConfig(badConfig)).toThrowError();

		badConfig['method_subscription'] = 'foo';
		expect(() => ConfigBuilder.verifyConfig(badConfig)).toThrowError();

		badConfig['method_subscription'] = 'only: {}';
		expect(() => ConfigBuilder.verifyConfig(badConfig)).toThrowError();
	});

	it('should catch missing filed', () => {
		let badConfig = JSON.parse(
			readFileSync(join(__dirname, '../../examples/config-dev-all.json')).toString()
		);
		delete badConfig['accounts'];
		expect(() => ConfigBuilder.verifyConfig(badConfig)).toThrowError();

		badConfig = JSON.parse(
			readFileSync(join(__dirname, '../../examples/config-dev-all.json')).toString()
		);
		delete badConfig['method_subscription'];
		expect(() => ConfigBuilder.verifyConfig(badConfig)).toThrowError();

		badConfig = JSON.parse(
			readFileSync(join(__dirname, '../../examples/config-dev-all.json')).toString()
		);
		delete badConfig['api_subscription'];
		expect(() => ConfigBuilder.verifyConfig(badConfig)).toThrowError();

		badConfig = JSON.parse(
			readFileSync(join(__dirname, '../../examples/config-dev-all.json')).toString()
		);
		delete badConfig['reporters'];
		expect(() => ConfigBuilder.verifyConfig(badConfig)).toThrowError();
	});
});

const r = (data: string): StartupReport => {
	return { _type: 'status', configName: data, time: new Date() };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('batch reporting', () => {
	it('reporters can be nested', () => {
		const consoleReporter = new ConsoleReporter();
		const outer = new BatchReporter(consoleReporter, 1000);
		outer.clean();
	});

	it('reports can be batched', async () => {
		const path = './test-output';
		unlinkSync(path);
		const reportLines = () =>
			existsSync(path) ? readFileSync(path).toString().split("\n").length - 1 : 0;
		const fsReporter = new FileSystemReporter({ path });
		const outer = new BatchReporter(fsReporter, 3000);

		expect(reportLines()).toEqual(0);

		outer.report(r('foo'));
		outer.report(r('bar'));
		outer.report(r('baz'));

		expect(reportLines()).toEqual(0);
		await sleep(3500);
		expect(reportLines()).toEqual(3);
		outer.clean();
	});

	it("notification report can be batched", () => {})
});
