import { GenericEvent, GenericExtrinsic } from '@polkadot/types';
import { Address } from '@polkadot/types/interfaces/runtime';
import { ISubscriptionTarget, MethodSubscription } from './config';

export interface ConcreteAccount {
	address: Address;
	nickname: string;
}

export class SubscriptionTarget implements ISubscriptionTarget {
	pallet: string;
	method: string;

	constructor(i: ISubscriptionTarget) {
		this.pallet = i.pallet;
		this.method = i.method;
	}

	matchPallet(pallet: string): boolean {
		return this.pallet === '*' || this.pallet === pallet;
	}

	matchMethod(method: string): boolean {
		return this.method === '*' || this.method === method;
	}

	match(t: ISubscriptionTarget): boolean {
		return this.matchPallet(t.pallet) && this.matchMethod(t.method);
	}
}

/**
 * An abstract type that an account can match with -- either a concrete account, or a wildcard.
 */
export type ExtendedAccount = ConcreteAccount | 'Wildcard';

/**
 * The accounts to which an event has matched.
 */
interface Matched {
	with: ExtendedAccount;
}

/// The outcome of a matching:
///
/// `false`, if this is not a match.
/// `true`, if this is a wildcard match.
/// `Matched`, if this matched against a specific account.
export type MatchOutcome = false | Matched | true;

/**
 * Match an event to a set of accounts, and see if it is a match.
 * @param event
 * @param accounts
 * @returns
 */
export function matchEventToAccounts(
	event: GenericEvent,
	accounts: ConcreteAccount[]
): MatchOutcome {
	if (accounts.length == 0) {
		return true;
	} else {
		const maybeMatch = accounts.find((e) => event.data.toString().includes(e.address.toString()));
		if (maybeMatch) {
			return { with: maybeMatch };
		} else {
			return false;
		}
	}
}

export function matchExtrinsicToAccounts(
	ext: GenericExtrinsic,
	accounts: ConcreteAccount[]
): MatchOutcome {
	if (accounts.length == 0) {
		return true;
	} else {
		const maybeMatch =
			accounts.find((e) => e.address.eq(ext.signer)) ||
			accounts.find((e) => ext.toString().includes(e.address.toString()));
		if (maybeMatch) {
			return { with: maybeMatch };
		} else {
			return false;
		}
	}
}

export function subscriptionFilter(t: ISubscriptionTarget, sub: MethodSubscription): boolean {
	switch (sub.type) {
		case 'all':
			return true;
		case 'ignore':
			return !sub.ignore.find((o) => new SubscriptionTarget(o).match(t));
		case 'only':
			return sub.only.some((o) => new SubscriptionTarget(o).match(t));
	}
}
