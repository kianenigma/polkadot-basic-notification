import { ExtendedAccount } from '../matching';
import { logger } from '../logger';
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { BatchConfig } from '../config';
export { EmailReporter } from './email';
export { FileSystemReporter } from './fs';
export { MatrixReporter } from './matrix';
export { ConsoleReporter } from './console';

const MAX_FORMATTED_MSG_LEN = 256;

enum COLOR {
	Primary = '#a3e4d7'
}

export type NotificationReportType = 'event' | 'extrinsic';

export interface EventInner {
	type: 'event';
	data: any;
}

export interface ExtrinsicInner {
	type: 'extrinsic';
	signer: string;
	nonce: number;
	data: any[];
}

export interface ReportDetail {
	pallet: string;
	method: string;
	account: ExtendedAccount;
	inner: EventInner | ExtrinsicInner;
}

export interface MiscReport {
	_type: 'misc';
	time: Date;
	message: string;
}

export interface NotificationReport {
	_type: 'notification';
	hash: string;
	number: number;
	chain: string;
	timestamp: number;
	details: ReportDetail[];
}

export type Report = NotificationReport | MiscReport;

export function serializeReport(report: Report): string {
	return JSON.stringify(report);
}

export function deserializeReport(input: string): Report {
	const obj = JSON.parse(input) as Report;
	switch (obj._type) {
		case 'notification': {
			const report: NotificationReport = { ...obj };
			report.details.forEach((d) => {
				if (d.inner.type == 'extrinsic') {
					d.inner.nonce = Number(d.inner.nonce);
				}
			});
			return report;
		}
		case 'misc': {
			const report: MiscReport = { ...obj };
			report.time = new Date(report.time);
			return report;
		}
	}
}

export interface Reporter {
	report(report: Report): Promise<void>;
	groupReport?(reports: Report[]): Promise<void>;
	clean?(): void;
}

interface ReporterHelper {
	htmlTemplate(): string;
	markdownTemplate(): string;
	rawTemplate(): string;
	jsonTemplate(): string;
}

export class GenericReporter implements ReporterHelper {
	innerHelper: StartupReporterHelper | NotificationReporterHelper;

	constructor(meta: Report) {
		switch (meta._type) {
			case 'notification':
				this.innerHelper = new NotificationReporterHelper(meta as NotificationReport);
				break;
			case 'misc':
				this.innerHelper = new StartupReporterHelper(meta as MiscReport);
		}
	}

	htmlTemplate(): string {
		return this.innerHelper.htmlTemplate();
	}
	markdownTemplate(): string {
		return this.innerHelper.markdownTemplate();
	}
	rawTemplate(): string {
		return this.innerHelper.rawTemplate();
	}
	jsonTemplate(): string {
		return this.innerHelper.jsonTemplate();
	}
}

class StartupReporterHelper implements ReporterHelper {
	meta: MiscReport;
	constructor(meta: MiscReport) {
		this.meta = meta;
	}

	htmlTemplate(): string {
		return `<p>${this.rawTemplate()}</p>`;
	}
	rawTemplate(): string {
		return `💌 Misc message: ${this.meta.message} at ${this.meta.time.toTimeString()}`;
	}
	markdownTemplate(): string {
		return this.rawTemplate();
	}
	jsonTemplate(): string {
		return JSON.stringify(this.meta);
	}
}

class NotificationReporterHelper implements ReporterHelper {
	meta: NotificationReport;

	constructor(meta: NotificationReport) {
		this.meta = meta;
	}

	trimStr(str: string): string {
		if (typeof str !== 'string') return str;
		return str.length < MAX_FORMATTED_MSG_LEN
			? str
			: `${str.substring(0, MAX_FORMATTED_MSG_LEN / 2)}..${str.substring(
				str.length - MAX_FORMATTED_MSG_LEN / 2,
				str.length
			)}`;
	}

	subscan(): string {
		return `https://${this.meta.chain.toLowerCase()}.subscan.io/block/${this.meta.number}`;
	}

	chain(): string {
		return `<b style="background-color: ${COLOR.Primary}">${this.meta.chain}</b>`;
	}

	method(detail: ReportDetail): string {
		return detail.method;
	}

	pallet(detail: ReportDetail): string {
		return detail.pallet;
	}

	data(detail: ReportDetail): string {
		return `[${detail.inner.data.map((d: any) => this.trimStr(d)).join(', ')}]`;
	}

	htmlTemplate(): string {
		return `
<p>
	<p>📣 <b> Notification</b> at ${this.chain()} #<a href='${this.subscan()}'>${this.meta.number
			}</a> aka ${new Date(this.meta.timestamp).toTimeString()}</p>
	<ul>
		${this.meta.details.map(
				(i) => `
		<li>
			💻 type: ${i.inner.type} | ${i.account === 'Wildcard'
						? ``
						: `for <b style="background-color: ${COLOR.Primary}">${i.account.nickname}</b> (${i.account.address})`
					}
				pallet: <b style="background-color: ${COLOR.Primary}">${this.pallet(i)}</b> |
				method: <b style="background-color: ${COLOR.Primary}">${this.method(i)}</b> |
				data: ${this.data(i)}
			</li>`
			)}
	</ul>
</p>
<details>
	<summary>Raw details</summary>
	<code>${JSON.stringify(this.meta)}</code>
</details>
`;
	}

	rawTemplate(): string {
		return `🎤 Events at #${this.meta.number}:  ${this.meta.details.map(
			(d) =>
				`\n\t🧾 ${d.inner.type} ${d.account === 'Wildcard' ? '' : `for ${d.account.nickname}`} |
\t💻 pallet: ${this.pallet(d)} - method :${this.method(d)}
\t💽 data: ${this.data(d)}]`
		)} (${this.subscan()})`;
	}

	markdownTemplate(): string {
		return `🎤 Events at [#${this.meta.number}](${this.subscan()}):  ${this.meta.details.map(
			(d) =>
				`\n\t🧾 _${d.inner.type}_ ${d.account === 'Wildcard' ? '' : `for **${d.account.nickname}**`}
\t💻 pallet: *${this.pallet(d)}* - method: *${this.method(d)}*
\t💽 data: \`${this.data(d)}\``
		)}`;
	}

	jsonTemplate(): string {
		return JSON.stringify(this.meta);
	}
}

export const SEPARATOR = ':-separator-:';

export class BatchReporter<Inner extends Reporter> implements Reporter {
	interval: number;
	storagePath: string;
	inner: Inner;
	handle: NodeJS.Timeout;
	misc: boolean;

	constructor(inner: Inner, { interval, misc, leftovers }: BatchConfig, storagePath: string) {
		this.interval = interval * 1000;
		this.storagePath = storagePath;
		this.inner = inner;
		this.misc = misc || false;

		const ignored = this.flush();
		if (ignored.length && leftovers) {
			logger.warn(`sending out ${ignored.length} old reports from ${storagePath}`);
			this.maybeGroupReport(ignored);
		} else if (ignored.length) {
			logger.warn(`ignoring ${ignored.length} old reports from ${storagePath}`);
		}

		this.handle = setInterval(async () => {
			const batchedReports = this.flush();
			if (this.misc) {
				this.inner.report({
					_type: 'misc',
					message: `flushing batches with interval ${this.interval}.`,
					time: new Date()
				});
			}
			this.maybeGroupReport(batchedReports);
		}, this.interval);

		logger.info(`setting up batch reporter with interval ${this.interval}.`);
	}

	maybeGroupReport(batchedReports: Report[]) {
		if (this.inner.groupReport) {
			this.inner.groupReport(batchedReports);
		} else {
			for (const report of batchedReports) {
				this.inner.report(report);
			}
		}
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
		logger.debug(`⏰ enqueuing report ${report._type} for later.`);
		appendFileSync(this.storagePath, packet);
	}

	report(report: Report): Promise<void> {
		if (this.misc) {
			switch (report._type) {
				case 'misc': {
					this.inner.report(report);
					break;
				}
				case 'notification': {
					this.enqueue(report);
				}
			}
		} else {
			this.enqueue(report);
		}
		return Promise.resolve();
	}

	clean(): void {
		clearInterval(this.handle);
		unlinkSync(this.storagePath);
	}
}
