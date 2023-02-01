import { GenericReporter, Report, Reporter } from '.';
import { MatrixConfig } from '../config';
import * as sdk from 'matrix-js-sdk';
import { logger } from '../logger';

export class MatrixReporter implements Reporter {
	client: sdk.MatrixClient;
	name: string;
	roomId: string;

	constructor(config: MatrixConfig) {
		this.name = 'matrix';
		this.client = sdk.createClient({
			baseUrl: config.server,
			accessToken: config.accessToken,
			userId: config.userId,
		});
		this.roomId = config.roomId;
		logger.info(
			`✅ [${this.name}] registering matrix reporter from ${config.userId} to ${this.roomId}@${config.server}.`
		);
	}

	async report(report: Report): Promise<void> {
		const innerContent = new GenericReporter(report).htmlTemplate();
		const content = {
			formatted_body: innerContent,
			body: innerContent,
			msgtype: 'm.text',
			format: 'org.matrix.custom.html'
		};
		await this.client.sendEvent(this.roomId, 'm.room.message', content, '');
	}

	// async groupReport(reports: Report[]): Promise<void> {
	// 	const innerContent = reports
	// 		.map((r) => new GenericReporter(r).htmlTemplate())
	// 		.join('\n</br>\n');
	// 	const content = {
	// 		formatted_body: innerContent,
	// 		body: innerContent,
	// 		msgtype: 'm.text',
	// 		format: 'org.matrix.custom.html'
	// 	};
	// 	await this.client.sendEvent(this.roomId, 'm.room.message', content, '');
	// }
}
