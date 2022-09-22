import { GenericReporter, Report, Reporter } from '.';
import { MatrixConfig } from '../config';
import * as sdk from 'matrix-js-sdk';
import { logger } from '../logger';

export class MatrixReporter implements Reporter {
	client: sdk.MatrixClient;
	roomId: string;

	constructor(config: MatrixConfig) {
		this.client = sdk.createClient({
			baseUrl: config.server,
			accessToken: config.accessToken,
			userId: config.userId
		});
		this.roomId = config.roomId;
		logger.info(
			`✅ registering matrix reporter from ${config.userId} to ${this.roomId}@${config.server}.`
		);
	}

	async report(meta: Report): Promise<void> {
		const innerContent = new GenericReporter(meta).htmlTemplate();
		const content = {
			formatted_body: innerContent,
			body: innerContent,
			msgtype: 'm.text',
			format: 'org.matrix.custom.html'
		};
		await this.client.sendEvent(this.roomId, 'm.room.message', content, '');
	}
}
