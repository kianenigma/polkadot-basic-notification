import * as sdk from "matrix-js-sdk";

// To shut up the console.info log that matrix defaults with.
import { logger } from 'matrix-js-sdk/lib/logger';
import log from "loglevel";

export interface MatrixConfig {
    userId: string,
    accessToken: string,
    roomId: string,
    server: string,
}

export class MatrixReporter {
    private client: sdk.MatrixClient;
    roomId: string;
    constructor(config: MatrixConfig) {
        this.client = sdk.createClient({
            baseUrl: config.server,
            accessToken: config.accessToken,
            userId: config.userId,
        });
        this.roomId = config.roomId;

        logger.setLevel(log.levels.INFO, false);
        //console.info(`registering matrix reporter from ${config.userId} to ${this.roomId}@${config.server}.`)
    }

    async sendHTML(message: string): Promise<void> {
        const content = {
            "formatted_body": message,
            "body": message,
            "msgtype": "m.text",
            "format": "org.matrix.custom.html",
        };
        await this.client.sendEvent(this.roomId, "m.room.message", content, "");
    }

    async send(msg: string): Promise<void> {
        const content = {
            "body": msg,
            "msgtype": "m.notice"
        };
        await this.client.sendEvent(this.roomId, "m.room.message", content);
    }
}

