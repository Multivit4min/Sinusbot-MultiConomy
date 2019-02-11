/* eslint-disable no-shadow */
registerPlugin({
  name: "MultiConomy Commmands",
  engine: ">= 0.13.37",
  version: "0.1.0",
  description: "Commands for Multiconomy",
  author: "Multivitamin <david.kartnaller@gmail.com",
  vars: [{
    name: "admins",
    title: "UIDs of users which have access to admin commands",
    type: "strings",
    default: []
  }]
}, (_, config) => {

  const engine = require("engine")
  const event = require("event")
  const backend = require("backend")
  const format = require("format")

  function allowAdminCommands(client) {
    switch (engine.getBackend()) {
      case "discord":
        return config.admins.includes(client.uid().split("/")[1])
      case "ts3":
        return config.admins.includes(client.uid())
      default:
        throw new Error(`Unknown backend ${engine.getBackend()}`)
    }
  }

  function getNameFromUid(uid) {
    const client = backend.getClientByUID(uid)
    return client ? client.nick() : uid
  }

  event.on("load", () => {
    const eco = require("MultiConomy")
    if (!eco) return engine.log("MultiConomy.js not found! Please be sure to install and enable MultiConomy.js")
    const Command = require("command")
    if (!Command) return engine.log("command.js not found! Please be sure to install and enable Command.js")
    const { createArgument, createCommandGroup } = Command


    const balanceCommand = createCommandGroup("balance")
      .help("manges balance of clients")
      .checkPermission(allowAdminCommands)

    //balance set <uid> <amount>
    balanceCommand
      .addCommand("set")
      .help("sets the balance of a client")
      .addArgument(createArgument("client").setName("uid"))
      .addArgument(createArgument("number").setName("amount").min(0).integer())
      .exec(async (client, { uid, amount }, reply) => {
        const wallet = await eco.getWallet(uid)
        wallet.setBalance(amount, "Set via Admin Command")
        reply(`Balance has been set to ${format.bold(amount)} for ${format.bold(getNameFromUid(uid))}!`)
      })

    //balance add <uid> <amount>
    balanceCommand
      .addCommand("add")
      .help("adds the balance to a client")
      .addArgument(createArgument("client").setName("uid"))
      .addArgument(createArgument("number").setName("amount").min(0).integer())
      .exec(async (client, { uid, amount }, reply) => {
        const wallet = await eco.getWallet(uid)
        wallet.addBalance(amount, "Added via Admin Command")
        reply(`${format.bold(amount)} have been added to ${format.bold(getNameFromUid(uid))}!`)
      })

    //balance remove <uid> <amount>
    balanceCommand
      .addCommand("remove")
      .help("remove the balance from a client")
      .addArgument(createArgument("client").setName("uid"))
      .addArgument(createArgument("number").setName("amount").min(0).integer())
      .exec(async (client, { uid, amount }, reply) => {
        const wallet = await eco.getWallet(uid)
        wallet.removeBalance(amount, "Removed by Admin Command")
        reply(`${format.bold(amount)} have been removed to ${format.bold(getNameFromUid(uid))}!`)
      })

    //balance remove <uid> <amount>
    balanceCommand
      .addCommand("view")
      .help("views the amount of funds a client has")
      .addArgument(createArgument("client").setName("uid"))
      .exec(async (client, { uid }, reply) => {
        const wallet = await eco.getWallet(uid)
        reply(`${getNameFromUid(wallet.getOwner())} owns ${wallet.getBalance()}${eco.getCurrencySign()}`)
      })

    //balance top
    balanceCommand
      .addCommand("top")
      .help("shows the top 5 richest users")
      .exec(async (client, _, reply) => {
        const toplist = await eco.getTopList()
        toplist.forEach((data, i) => {
          reply(`${i+1} - ${format.bold(`${data.balance}${eco.getCurrencySign()}`)} - ${data.nick}`)
        })
      })

    //wallet - view your balance
    const walletCommand = createCommandGroup("wallet")
      .help("manges your wallet")
      .exec(async (client, _, reply) => {
        const wallet = await eco.getWallet(client)
        reply(`You own ${wallet.getBalance()}${eco.getCurrencySign()}`)
      })

    //wallet history - gets the last 50 transactions you made
    walletCommand
      .addCommand("history")
      .help("view your transaction history")
      .manual(`displays details about your 50 last transactions`)
      .exec(async (client, _, reply) => {
        try {
          const wallet = await eco.getWallet(client)
          const history = await wallet.getHistory(50)
          if (history.length === 0) return reply("No transactions found!")
          history.forEach(({ change, reason }) => reply(`${format.bold(change < 0 ? `[color=red]${change}[/color]` : `[color=green]${change}[/color]`)} - ${reason}`))
        } catch (e) {
          engine.log(e.stack)
        }
      })

    //wallet pay <client> <amount> - sends the amount of money to another client
    walletCommand
      .addCommand("pay")
      .help("sends money to another client")
      .manual(`The first parameter should be a user which receives the money`)
      .manual(`The Second Parameter is the amount which the users receives`)
      .addArgument(createArgument("client").setName("receiver"))
      .addArgument(createArgument("number").setName("amount").positive().integer())
      .exec(async (client, { receiver, amount }, reply) => {
        try {
          const [receiverWallet, senderWallet] = await Promise.all([eco.getWallet(receiver), eco.getWallet(client)])
          if (!senderWallet.hasFunds(amount)) return reply("You do not have enough funds to do this transaction!")
          receiverWallet.addBalance(amount, `Received from ${senderWallet.getOwner()}`)
          senderWallet.removeBalance(amount, `Sent to ${receiverWallet.getOwner()}`)
          reply(`You have sent ${amount}${eco.getCurrencySign()} to ${getNameFromUid(receiver)}!`)
          const receiverClient = backend.getClientByUID(receiver)
          if (!receiverClient) return
          receiverClient.chat(`You have received ${amount}${eco.getCurrencySign()} from ${getNameFromUid(client.nick())}!`)
        } catch (e) {
          engine.log(e.stack)
        }
      })


  })
})