# Polkadot Basic Notifications 🔴 📣

A _dead-simple_, yet \*highly **effective\*** notification system for Polkadot and its parachains (or,
any substrate-based chain).

![Untitled(2)](https://user-images.githubusercontent.com/5588131/158027440-a819bad8-c28a-4662-9c5a-b2f850f6ee36.png)

Supported reporters:

- Email (with optional end to end encryption)
- Telegram
- Matrix
- Filesystem

Lastly, as of the recent 1.0 release, this exporter also supports **report batching**. In essence, multiple notifications are stored in a temporary storage, and are are batch-reported all at once. This is quite useful for e.g. your staking rewards, not receiving a single email
reward, rather a batch once a day/week.

## Configuration

You need to provide one configuration file to the program, which specifies:

1. which accounts you want to monitor.
2. which chains you want to monitor.
3. which methods (event, transactions) you want to monitor.
4. which reporters you want to use.

These configurations can be provided either as JSON or YAML. See [Examples](./examples/) folder, or the following:

```javascript
{
  // your list of accounts. For chains that use ethereum based accounts (e.g. moonbeam),
  // just use your account's public key as hex (`0xabc..`).
  //
  // If the list is empty, then no account filter is applied. This means that all events and
  // transactions will match.
  "accounts": [
    { "address": "<ss58_address>", "nickname": "<account_nickname>" },
  ],
  // a list of ws-endpoint to which we start to listen. For example, Polkadot's is "wss://rpc.
  // polkadot.io". The cool thing here is that ANY substrate-based chain will work, so you can add
  // accounts from parachains (Acala, Statemine), solo-chains (Aleph-zero), or even ethereum-based
  // chains like moonbeam.
  "endpoints": [
    "wss://rpc.polkadot.io",
    "wss://statemine-rpc.polkadot.io",
    "wss://acala-polkadot.api.onfinality.io/public-ws",
    "wss://wss.api.moonbeam.network",
    "wss://ws.azero.dev"
  ],
  // a case-sensitive list of methods that you want to subscribe to to. A 'method' is either the
  // name of a transaction (usually lower_snake_case) or an event name (usually lowerCamelCase).
  // 3 types exist here: 'Only', 'ignore', or 'all'.
  "method_subscription": {
    // chose one of the below 3 options:
    // Listen to all methods. Useful to track all interactions around an account.
    { 'type': 'all' }
    // Listen only to these methods:
    {
      'type': 'only'
      "only": [
        {
          "pallet": "balances",
          "method": "transfer"
        },
        {
          "pallet": "electionProvierMultiPhase",
          "method": "*"
        },
        {
          "pallet": "*",
          "method": "remark"
        }
      ]
    }
    // listen to all except these methods. Useful to reduce the noise of 'all' type.
    {
      'type': 'ignore'
      "ignore": [..]
    }
  },

  // This is where you specify which reporters you want to use.
  "reporters": {
    // if provided, report all events to a matrix room.
    "matrix": {
      // the user if of some user from which you will send the message.
      "userId": "@your-username:matrix.org",
      // the access token of the aforementioned user.
      "accessToken": "..",
      // the id of the room to which you will send the message.
      "roomId": "..",
      // the serve in which your user exist.
      "server": "https://matrix.org"
    },

    // if provided, report all events to a set of email addresses.
    "email": {
      // the address from which you send the emails. It must be owned by the `transporter.auth`
      //credentials once authenticated with `transporter.host`.
      "from": "from@polkadot-basic-notification.xyz",
      // The list of addresses that get notified.
      "to": ["from1@dot-basic-notification.xyz", "from2@dot-basic-notification.xyz"],
      // optional: if provided, your messages will be encrypted, but the formatting might not be as good.
      "gpgpubkey": "./pub.key",
      // this must be exactly the same object as used in the nodemailer library. See here for
      // more information: https://nodemailer.com/smtp/
      "transporter": {
        "host": "smtp.youremail.org",
        "port": 587,
        "secure": false,
        "auth": {
          "user": "...",
          "pass": "..."
        }
      }
    },

    "telegram": {
      // the id of the chat to which you want to send the message. The bot/account of choice
      // must be allowed to send messages to this chat.
      // see: https://stackoverflow.com/questions/32423837/telegram-bot-how-to-get-a-group-chat-id
      "chatId": "123455",
      // the access token of the bot.
      "botToken": "..."
    }

    // if provided, writes all reports to the file at the given path. The file is appended to
    "fs": {
      "path": "./out1.log"
    },

    // enabling this will print all reports to console as well.
    "console": {},

    // any of the reporters can be batched. For example, a batched telegram reporter that send
    // an update once per-day looks like this:
    "telegram": {
      "chatId": "123455",
      "botToken": "...",
      // batching interval is in seconds. If `misc` is set to true, miscellaneous messages
      // (such as the startup report) are forwarded immediately, rather than being batched.
      "batch": { "interval": 86400, "misc": true }
    }
  }
}

```

## Deployment

I made this project to be as easy as possible to deploy, so that you don't need to rely on a 3rd
party service to receive notifications for your accounts. Although, in the above examples, you are
still relying on the honesty of the ws-nodes to which you connect. To take it a step further, you
can consider running your own nodes.

The easiest way to deploy this application is using `pm2`, or any other typical node-js deployment
service. There is already a template `pm2.config.js` provided, which you can use as

```
$ yarn run deploy:pm2
```

Alternatively, you can build a docker image from from this application based on the provided
`Dockerfile`. To build the image:

```
$ docker build . -t polkadot-basic-notification -f builder.Dockerfile
$ # note how the config file must be passed as an environment variable.
$ docker run -e CONF=config.json polkadot-basic-notification
```
