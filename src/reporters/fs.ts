import { appendFileSync } from 'fs';
import { GenericReporter, Report, Reporter } from '.';
import { FsConfig } from '../config';
import { logger } from '../logger';

export class FileSystemReporter implements Reporter {
	name: string
	path: string;
	constructor(config: FsConfig) {
		this.name = 'fs';
		this.path = config.path;
		logger.info(`✅ [${this.name}] registering file system reporter`);
	}

	report(meta: Report): Promise<void> {
		appendFileSync(this.path, `${new GenericReporter(meta).rawTemplate()}\n`);
		return Promise.resolve();
	}
}
