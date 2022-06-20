import { createServer, Server } from 'http';

/*
 * This is a very simplified readiness probe that responds to any url with a status code
 * Can be further extended to provide metrics and
 */
export class Healthprobe {
	private port = 3000;
	private server: Server;

	ready = false;

	constructor() {
		this.server = createServer();

		this.server.on('request', async (_, res) => {
			if (this.ready) {
				res.writeHead(200);
				res.end('OK');
			} else {
				res.writeHead(503);
				res.end('NOT READY');
			}
		});
	}

	async listen() {
		this.server.listen(this.port);
	}
}
