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

  function allowAdminCommands(client) {
    return config.admins.indexOf(client.uid()) >= 0
  }

  function getNameFromUid(uid) {
    var client = backend.getClientByUID(uid)
    return client ? client.nick() : uid
  }

  event.on("load", () => {
    const eco = require("MultiConomy")
    if (!eco) return engine.log("MultiConomy.js not found! Please be sure to install and enable MultiConomy.js")
    const Command = require("Command")
    if (!Command) return engine.log("Command.js not found! Please be sure to install and enable Command.js")
    const { createCommand, createArgument, getCommandPrefix } = Command

    createCommand("balance")
      .help("Shows your current balance")
      .exec(async (client, _, reply) => {
        return new Promise(async (fulfill, reject) => {
          try {
            reply(`You own [b]${await eco.getBalance(client)}${eco.getCurrencySign()}[/b]`)
            fulfill()
          } catch (e) {
            reject(e)
          }
        })
      })

    createCommand("top")
      .help("Shows balance of the top users")
      .manual(`Gets the top 10 richest clients`)
      .exec((client, _, reply) => {
        return new Promise(async (fulfill, reject) => {
          try {
            var top = await eco.getTopList(0, 10)
            if (top.length === 0) return reply("No Clients found")
            top.map(({balance, nick}) => reply(`[b]${nick}[/b] ${balance}${eco.getCurrencySign()}`))
            fulfill()
          } catch (e) {
            reject(e)
          }
        })
      })

    createCommand("setbalance")
      .help("sets the balance of a user to the given amount")
      .checkPermission(allowAdminCommands)
      .addArgument(createArgument("client").setName("uid"))
      .addArgument(createArgument("number").setName("amount").min(0).integer())
      .exec((client, { uid, amount }, reply) => {
        return new Promise(async (fulfill, reject) => {
          try {
            await eco.setBalance(uid, amount)
            reply(`Balance has been set to [b]${amount}[/b] for [b]${getNameFromUid(uid)}[/b]!`)
            fulfill()
          } catch (e) {
            reject(e)
          }
        })
      })

    createCommand("pay")
      .help("sends money to another client")
      .manual(`The first parameter should be a user which receives the money\nThe Second Parameter is the amount which the users receives`)
      .addArgument(createArgument("client").setName("receiver"))
      .addArgument(createArgument("number").setName("amount").positive().integer())
      .exec((client, { receiver, amount }, reply) => {
        return new Promise(async (fulfill, reject) => {
          try {
            await eco.createTransaction()
              .amount(amount)
              .sender(client)
              .receiver(receiver)
              .execute()
            reply(`You have sent [b]${amount} ${eco.getCurrencySign()}[/b] to [b]${getNameFromUid(uid)}[/b]!`)
            fulfill()
          } catch (e) {
            if (e.constructor.name === "TransActionError") {
              reply(`Failed to create Transaction: [b]${e.message}[/b]`)
              return fulfill()
            }
            reject(e)
          }
        })
      })

  })
})