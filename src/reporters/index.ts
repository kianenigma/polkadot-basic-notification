import { Hash } from '@polkadot/types/interfaces/runtime';
import { GenericExtrinsic, GenericEvent } from '@polkadot/types/';
import { Codec } from '@polkadot/types-codec/types';
import { ExtendedAccount } from '../matching';
import { formatBalance } from '@polkadot/util';
import { EventStatus } from 'matrix-js-sdk';

export { EmailReporter } from './email';
export { FileSystemReporter } from './fs';
export { MatrixReporter } from './matrix';
export { ConsoleReporter } from './console';

const MAX_FORMATTED_MSG_LEN = 256;

enum COLOR {
	Primary = '#a3e4d7'
}

export enum NotificationReportType {
	Event = 'Event',
	Extrinsic = 'Extrinsic'
}

export interface ReportInput {
	account: ExtendedAccount;
	type: NotificationReportType;
	pallet: string;
	method: string;
	inner: GenericEvent | GenericExtrinsic;
}

export interface StartupReport {
	_type: 'status';
	time: Date;
	configName: string;
}

export interface NotificationReport {
	_type: 'notification';
	hash: Hash;
	number: number;
	chain: string;
	timestamp: number;
	inputs: ReportInput[];
}

export type Report = NotificationReport | StartupReport;

export function serializeReport(report: Report): string {
	return JSON.stringify(report);
}

export function deserializeReport(input: string): Report {
	const obj = JSON.parse(input) as Report;
	switch (obj._type) {
		case 'notification': {
			process.exit(1);
			break;
		}
		case 'status': {
			const report: StartupReport = { ...obj };
			report.time = new Date(report.time);
			return report;
		}
	}
}

/// Method of a transaction or an event, e.g. `transfer` or `Deposited`.
export function methodOf(
	type: NotificationReportType,
	input: GenericEvent | GenericExtrinsic
): string {
	if (type === NotificationReportType.Event) {
		return input.method.toString();
	} else {
		return (input as GenericExtrinsic).meta.name.toString();
	}
}

/// Pallet of a transaction or an event, e.g. `Balances` or `System`.
export function palletOf(
	type: NotificationReportType,
	input: GenericEvent | GenericExtrinsic
): string {
	if (type === NotificationReportType.Event) {
		// TODO: there's probably a better way for this?
		// @ts-ignore
		return input.toHuman().section;
	} else {
		return (input as GenericExtrinsic).method.section.toString();
	}
}

export interface Reporter {
	report(report: Report): Promise<void>;
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
			case 'status':
				this.innerHelper = new StartupReporterHelper(meta as StartupReport);
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
	meta: StartupReport;
	constructor(meta: StartupReport) {
		this.meta = meta;
	}

	htmlTemplate(): string {
		return `<p>${this.rawTemplate()}</p>`;
	}
	rawTemplate(): string {
		return `Program with config ${
			this.meta.configName
		} (re)started at ${this.meta.time.toTimeString()}`;
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
		return str.length < MAX_FORMATTED_MSG_LEN
			? str
			: `${str.substring(0, MAX_FORMATTED_MSG_LEN / 2)}..${str.substring(
					str.length - MAX_FORMATTED_MSG_LEN / 2,
					str.length
			  )}`;
	}

	formatData(data: Codec): string {
		const r = data.toRawType().toLowerCase();
		if (r == 'u128' || r.toLowerCase() == 'balance') {
			// @ts-ignore
			return formatBalance(data);
		} else {
			return this.trimStr(data.toString());
		}
	}

	subscan(): string {
		return `https://${this.meta.chain.toLowerCase()}.subscan.io/block/${this.meta.number}`;
	}

	chain(): string {
		return `<b style="background-color: ${COLOR.Primary}">${this.meta.chain}</b>`;
	}

	method(input: ReportInput): string {
		return input.method;
	}

	pallet(input: ReportInput): string {
		return input.pallet;
	}

	data(input: ReportInput): string {
		if (input.type === NotificationReportType.Event) {
			return `[${(input.inner as GenericEvent).data.map((d) => this.formatData(d)).join(', ')}]`;
		} else {
			return `[${(input.inner as GenericExtrinsic).method.args
				.map((d) => this.formatData(d))
				.join(', ')}]`;
		}
	}

	htmlTemplate(): string {
		const { inputs, ...rest } = this.meta;
		const trimmedInputs = inputs.map(({ account, type, inner }) => {
			return { account, type, inner: this.trimStr(inner.toString()) };
		});
		// @ts-ignore
		rest.inputs = trimmedInputs;
		return `
<p>
	<p>📣 <b> Notification</b> at ${this.chain()} #<a href='${this.subscan()}'>${
			this.meta.number
		}</a> aka ${new Date(this.meta.timestamp).toTimeString()}</p>
	<ul>
		${this.meta.inputs.map(
			(i) => `
		<li>
			💻 type: ${i.type} | ${
				i.account === 'Wildcard'
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
	<code>${JSON.stringify(rest)}</code>
</details>
`;
	}

	rawTemplate(): string {
		return `🎤 Events at #${this.meta.number}:  ${this.meta.inputs.map(
			(i) =>
				`\n\t🧾 ${i.type} ${i.account === 'Wildcard' ? '' : `for ${i.account.nickname}`} |
\t💻 pallet: ${this.pallet(i)} - method :${this.method(i)}
\t💽 data: ${this.data(i)}]`
		)} (${this.subscan()})`;
	}

	markdownTemplate(): string {
		return `🎤 Events at [#${this.meta.number}](${this.subscan()}):  ${this.meta.inputs.map(
			(i) =>
				`\n\t🧾 _${i.type}_ ${i.account === 'Wildcard' ? '' : `for **${i.account.nickname}**`}
\t💻 pallet: *${this.pallet(i)}** - method: *${this.method(i)}**
\t💽 data: \`${this.data(i)}\``
		)}`;
	}

	jsonTemplate(): string {
		return JSON.stringify(this.meta);
	}
}
