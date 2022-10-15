import { deserializeReport, GenericReporter, Report, Reporter, serializeReport } from '.';
import { logger } from '../logger';
import {} from 'node:path';
import { appendFileSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';

export class ConsoleReporter implements Reporter {
	constructor() {
		logger.info(`✅ registering console reporter`);
	}

	report(report: Report): Promise<void> {
		console.log(new GenericReporter(report).rawTemplate());
		return Promise.resolve();
	}
}

export const SEPARATOR = ':-separator-:';

export class BatchReporter<Inner extends Reporter> implements Reporter {
	interval: number;
	storagePath: string;
	inner: Inner;
	handle: NodeJS.Timer;

	constructor(inner: Inner, interval: number, storagePath: string) {
		this.interval = interval;
		this.storagePath = storagePath;
		this.inner = inner;

		const ignore = this.flush();
		if (ignore.length) {
			logger.warn(`ignoring ${ignore.length} old reports from ${storagePath}`);
		}

		this.handle = setInterval(async () => {
			const batchedReports = this.flush();
			for (const report of batchedReports) {
				this.inner.report(report);
			}
		}, this.interval);
	}

	flush(): Report[] {
		const reports = existsSync(this.storagePath)
			? readFileSync(this.storagePath)
					.toString()
					.split(SEPARATOR)
					.filter((line) => line.length)
					.map((line) => deserializeReport(line))
			: [];
		writeFileSync(this.storagePath, '');
		return reports;
	}

	enqueue(report: Report) {
		const packet = `${serializeReport(report)}${SEPARATOR}`;
		appendFileSync(this.storagePath, packet);
	}

	report(report: Report): Promise<void> {
		this.enqueue(report);
		return Promise.resolve();
	}

	clean(): void {
		clearInterval(this.handle);
		unlinkSync(this.storagePath);
	}
}
