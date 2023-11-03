import { existsSync, readdirSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { ConfigBuilder } from '../config';
import {
	BatchReporter,
	ConsoleReporter,
	FileSystemReporter,
	MiscReport,
	NotificationReport
} from '../reporters';

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

	it('should catch bad batch config', () => {
		const badConfig = JSON.parse(
			readFileSync(join(__dirname, '../../examples/config-dev-batched.json')).toString()
		);
		badConfig['reporters']['console']['batch']['interval'] = 'FOO';
		expect(() => ConfigBuilder.verifyConfig(badConfig)).toThrowError();
	});
});

const r = (message: string): MiscReport => {
	return { _type: 'misc', message, time: new Date() };
};

const n = (): NotificationReport => {
	return {
		_type: 'notification',
		chain: 'foo',
		details: [],
		number: 10,
		hash: '0x123',
		timestamp: 10
	};
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const CONSOLE_PATH = './dont-care';
const BATCH_PATH = './test-data';
const reportLines = () =>
	existsSync(CONSOLE_PATH) ? readFileSync(CONSOLE_PATH).toString().split('\n').length - 1 : 0;

describe('batch reporting', () => {
	beforeEach(() => {
		if (existsSync(BATCH_PATH)) unlinkSync(BATCH_PATH);
		if (existsSync(CONSOLE_PATH)) unlinkSync(CONSOLE_PATH);
	});

	it('reporters can be nested', () => {
		const consoleReporter = new ConsoleReporter();

		expect(!BATCH_PATH);
		const outer = new BatchReporter(consoleReporter, { interval: 1 }, BATCH_PATH);
		expect(BATCH_PATH);
		outer.clean();
		expect(!existsSync('./test-data'));
	});

	it('misc reports can be dispatched immediately', async () => {
		const fsReporter = new FileSystemReporter({ path: CONSOLE_PATH });
		const outer = new BatchReporter(fsReporter, { interval: 3, misc: true }, BATCH_PATH);

		expect(reportLines()).toEqual(0);

		outer.report(r('foo'));
		expect(reportLines()).toEqual(1);
		outer.report(r('bar'));
		expect(reportLines()).toEqual(2);
		outer.report(r('baz'));

		expect(reportLines()).toEqual(3);
		outer.clean();
	});

	it('notification report can be batched', async () => {
		const fsReporter = new FileSystemReporter({ path: CONSOLE_PATH });
		const outer = new BatchReporter(fsReporter, { interval: 1 }, BATCH_PATH);

		expect(reportLines()).toEqual(0);

		outer.report(n());
		outer.report(n());
		outer.report(n());

		expect(reportLines()).toEqual(0);

		await sleep(3500);

		expect(reportLines()).toEqual(3);
		outer.clean();
	});

	it('storage is cleaned', async () => {
		const fsReporter = new FileSystemReporter({ path: CONSOLE_PATH });
		const outer = new BatchReporter(fsReporter, { interval: 3 }, BATCH_PATH);

		expect(existsSync(BATCH_PATH));
		outer.report(n());
		outer.report(n());
		outer.report(n());
		expect(existsSync(BATCH_PATH));

		await sleep(3500);
		expect(existsSync(BATCH_PATH));

		expect(existsSync(BATCH_PATH));
		outer.clean();
		expect(!existsSync(BATCH_PATH));
	});
});
