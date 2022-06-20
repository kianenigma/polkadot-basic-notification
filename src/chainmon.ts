import { ExtendedAccount } from "./config"
import { ApiPromise, WsProvider } from "@polkadot/api";
import { Hash, Header } from "@polkadot/types/interfaces/runtime";
import { GenericExtrinsic } from "@polkadot/types/"

import "@polkadot/api-augment";
import "@polkadot/types-augment";

export interface ExtrinsicItem {
    index: number,
    section: string,
    method: string,
    account: ExtendedAccount,
}

export interface EventItem {
    section: string,
    method: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any, // any is correct for now because it's a mutable type
}

// This holds the raw blockdata,
// the blockhandler extracts relevant data into a "Report" item.
export interface blockData {
    chain: string,
    number: number,
    hash: Hash,
    timestamp: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    events: any[], //any is correct for now because it's a mutable type
    extrinsics: GenericExtrinsic[]
}

export interface Report {
    chain: string,
    blocknumber: number,
    hash: Hash,
    timestamp: number,
    extrinsics?: ExtrinsicItem[],
    events?: EventItem[],
}


export class Chainmon {
    private provider!: WsProvider;
    private api!: ApiPromise;
    chain!: string;


    constructor(
        private rpcEndpoint: string
    ) {
        this.provider = new WsProvider(this.rpcEndpoint);
        this.api = new ApiPromise({ provider: this.provider });
    }

    // This allows us to await for the chain initialization
    // You can not await a constructor. It also gets the chain name from the api
    async init() {
        await this.api.isReady;
        this.chain = (await this.api.rpc.system.chain()).toString()
    }

    // todo: define function interface
    async subscribeHandler(handler: (h: Header) => void) {
        this.api.rpc.chain.subscribeFinalizedHeads((header) => {
            handler(header);
        });
    }

    async getBlockData(blockheader: Header) {
        const blockApi = await this.api.at(blockheader.hash);
        const timestamp = (await blockApi.query.timestamp.now()).toBn().toNumber()
        const events = await blockApi.query.system.events();

        const signedBlock = await this.api.rpc.chain.getBlock(blockheader.hash);
        const extrinsics = signedBlock.block.extrinsics;

        // downstream functions need these values.
        const block: blockData = {
            chain: this.chain,
            number: blockheader.number.toNumber(),
            hash: blockheader.hash,
            timestamp: timestamp,
            events: events,
            extrinsics: extrinsics
        };
        return block;
    }

    async getHeaderFromBlockNumber(number: number) {
        const blockHash = await this.api.rpc.chain.getBlockHash(number);
        return this.api.rpc.chain.getHeader(blockHash);
    }
}


export function ReportHTML(report: Report) {
    const header = `<p>
        <p>📣 <b> Notification</b> at ${report.chain}
            <a href='https://${report.chain}.subscan.io/block/${report.blocknumber}'>#${report.blocknumber}</a>
            on ${new Date(report.timestamp).toTimeString()}</p>
        <ul>`;

    let listExtrinsics: string[] = [];
    if (typeof report.extrinsics !== 'undefined') {
        listExtrinsics = report.extrinsics.map((item) => `
            <li>
               Extrinsic <a href='https://${report.chain}.subscan.io/extrinsic/${report.blocknumber}-${item.index}'>#${report.blocknumber}-${item.index}</a></br>
               | <b style='background-color: #a3e4d7'> ${item.account.address.toString()} </b> ${item.account.label}
               | method: <b style="background-color: #a3e4d7" > ${item.section}.${item.method} </b>
            </li>`);
    }

    let listEvents: string[] = [];
    if (typeof report.events !== 'undefined') {
        listEvents = report.events.map((item) => `
            <li>
               Event | method: <b style="background-color: #a3e4d7" > ${item.section}.${item.method} </b></br>
               Data | ${JSON.stringify(item.data)}
            </li>`);
    }

    const footer = `
        </ul>
        <details>
        <summary>Raw details </summary>
        <code> ${JSON.stringify(report.extrinsics)} ${JSON.stringify(report.events)} </code>
        </details>`;

    return header + listExtrinsics + listEvents + footer;
}
