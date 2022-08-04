import { Hash } from '@polkadot/types/interfaces/runtime';
import { GenericExtrinsic, GenericEvent } from '@polkadot/types/';
import { Codec } from '@polkadot/types-codec/types';
import { ExtendedAccount } from '../matching';
import { formatBalance } from '@polkadot/util';

export { EmailReporter } from './email';
export { FileSystemReporter } from './fs';
export { MatrixReporter } from './matrix';
export { ConsoleReporter } from './console';

const MAX_FORMATTED_MSG_LEN = 256;

enum COLOR {
	Primary = '#a3e4d7'
}

export enum ReportType {
	Event = 'Event',
	Extrinsic = 'Extrinsic'
}

export interface ReportInput {
	account: ExtendedAccount;
	type: ReportType;
	pallet: string;
	method: string;
	inner: GenericEvent | GenericExtrinsic;
}

export interface Report {
	hash: Hash;
	number: number;
	chain: string;
	timestamp: number;
	inputs: ReportInput[];
}

/// Method of a transaction or an event, e.g. `transfer` or `Deposited`.
export function methodOf(type: ReportType, input: GenericEvent | GenericExtrinsic): string {
	if (type === ReportType.Event) {
		return input.method.toString();
	} else {
		return (input as GenericExtrinsic).meta.name.toString();
	}
}

/// Pallet of a transaction or an event, e.g. `Balances` or `System`.
export function palletOf(type: ReportType, input: GenericEvent | GenericExtrinsic): string {
	if (type === ReportType.Event) {
		// TODO: there's probably a better way for this?
		// @ts-ignore
		return input.toHuman().section;
	} else {
		return (input as GenericExtrinsic).method.section.toString();
	}
}

export interface Reporter {
	report(report: Report): Promise<void>;
}

export class GenericReporter {
	meta: Report;

	constructor(meta: Report) {
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
		if (input.type === ReportType.Event) {
			return `[${(input.inner as GenericEvent).data.map((d) => this.formatData(d)).join(', ')}]`;
		} else {
			return `[${(input.inner as GenericExtrinsic).method.args
				.map((d) => this.formatData(d))
				.join(', ')}]`;
		}
	}

	HTMLTemplate(): string {
		const { inputs, ...rest } = this.meta;
		const trimmedInputs = inputs.map(({ account, type, inner }) => {
			return { account, type, inner: this.trimStr(inner.toString()) };
		});
		// @ts-ignore
		rest.inputs = trimmedInputs;
		return `
<p>
	<p>📣 <b> Notification</b> at ${this.chain()} #<a href='${this.subscan()}'>${this.meta.number
			}</a> aka ${new Date(this.meta.timestamp).toTimeString()}</p>
	<ul>
		${this.meta.inputs.map(
				(i) => `
		<li>
			💻 type: ${i.type} | ${i.account === 'Wildcard'
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
				`[🧾 ${i.type} ${i.account === 'Wildcard' ? '' : `for ${i.account.nickname}`
				} | 💻 pallet: ${this.pallet(i)} - method:${this.method(i)} | 💽 data: ${this.data(i)}]`
		)} (${this.subscan()})`;
	}

	jsonTemplate(): string {
		return JSON.stringify(this.meta);
	}
}
