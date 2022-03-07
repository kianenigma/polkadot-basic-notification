module.exports = {
	apps : [
		{
			name: "polkadot-basic-notifications",
			script: "./build/index.js",
			watch: true,
			env: {
				"LOG_LEVEL": "info",
			  }
		}
	]
}
