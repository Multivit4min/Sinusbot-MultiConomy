registerPlugin({
  name: "MultiConomy Vote",
  engine: ">= 1.0.0",
  version: "0.1.0",
  description: "Commands for Multiconomy",
  author: "Multivitamin <david.kartnaller@gmail.com",
  requiredModules: ["http"],
  vars: [{
    name: "KEY",
    title: "TeamSpeak Servers API Key",
    type: "string",
    default: false
  }, {
    name: "SID",
    title: "TeamSpeak Servers Server ID",
    type: "number",
    default: false
  }, {
    name: "REWARD",
    title: "Money per vote",
    type: "number",
    default: 0
  }]
}, (_, config) => {

  const engine = require("engine")
  const event = require("event")
  const store = require("store")
  const http = require("http")
  const backend = require("backend")
  const checkInterval = 60 * 1000

  if (typeof store.getInstance("unclaimedVotes") !== "object") store.setInstance("unclaimedVotes", [])

  function fetchVotes() {
    return new Promise((fulfill, reject) => {
      http.simpleRequest({
        method: "GET",
        url: `https://teamspeak-servers.org/api/?object=servers&element=votes&key=${config.KEY}&format=json`
      }, (err, res) => {
        if (err) return reject(new Error(`Failed to retrieve data from teamspeak-servers.org api! (Error ${err})`))
        if (res.statusCode !== 200) return reject(new Error(`Failed to retrieve data from teamspeak-servers.org api! (Code ${res.statusCode})`))
        try {
          fulfill(JSON.parse(res.data.toString()).votes)
        } catch (e) {
          return reject(e)
        }
      })
    })
  }


  event.on("load", () => {
    const eco = require("MultiConomy")
    if (!eco) return engine.log("MultiConomy.js not found! Please be sure to install and enable MultiConomy.js")
    const Command = require("command")
    if (!Command) return engine.log("command.js not found! Please be sure to install and enable command.js")
    const { createCommand } = Command

    async function addReward(client) {
      const wallet = await eco.getWallet(client)
      wallet.addBalance(config.REWARD, "vote reward teamspeak-servers.org")
      client.chat(`You have been rewarded [b]${config.REWARD}${eco.getCurrencySign()}[/b] for voting on teamspeak-servers.org!`)
    }

    createCommand("vote")
      .help("retrieves the vote link from teamspeak-servers.org")
      .manual("retrieves the vote link for teamspeak-servers.org")
      .manual(`vote daily to get rewarded with ${eco.getCurrencyName()}`)
      // eslint-disable-next-line no-shadow
      .exec((client, _, reply) => {
        reply(`[b][url=https://teamspeak-servers.org/server/${config.SID}/vote/?username=${encodeURI(client.nick())}]VOTE HERE[/url]`)
        reply(`It can take a few minutes until your vote gets counted!`)
      })

    event.on("clientMove", ({fromChannel, client}) => {
      if (typeof fromChannel === "number") return
      const unclaimed = store.getInstance("unclaimedVotes")
      if (unclaimed.indexOf(client.nick()) === -1) return
      unclaimed.splice(unclaimed.indexOf(client.nick()), 1)
      store.setInstance("unclaimedVotes", unclaimed)
      const votes = store.getInstance(`votes_${encodeURI(client.nick())}`)
      Object.keys(votes)
        .filter(k => votes[k].claimedBy === false)
        .forEach(k => {
          votes[k].claimedBy = client.uid()
          votes[k].claimedAt = Date.now()
          addReward(client)
        })
      store.setInstance(`votes_${encodeURI(client.nick())}`, votes)
    })

    setInterval(() => {
      fetchVotes()
        .then(votes => {
          votes.forEach(vote => {
            //get the votes of the specific client
            let nickVotes = store.getInstance(`votes_${encodeURI(vote.nickname)}`)
            //no votes exist yet create a new Object
            if (nickVotes === undefined) nickVotes = {}
            //vote already has been added
            if (nickVotes[String(vote.timestamp)] !== undefined) return
            //add a new vote to the array
            nickVotes[String(vote.timestamp)] = {
              nickname: vote.nickname,
              claimedBy: false,
              claimedAt: 0
            }
            //try to get a client by name
            const client = backend.getClientByName(vote.nickname)
            if (client) {
              //client found
              nickVotes[String(vote.timestamp)].claimedBy = client.uid()
              nickVotes[String(vote.timestamp)].claimedAt = Date.now()
              addReward(client)
            } else {
              //no client found add it to the unclaimed list
              const unclaimed = store.getInstance("unclaimedVotes")
              if (unclaimed.indexOf(vote.nickname) === -1) {
                unclaimed.push(vote.nickname)
                store.setInstance("unclaimedVotes", unclaimed)
              }
            }
            store.setInstance(`votes_${encodeURI(vote.nickname)}`, nickVotes)
          })

        })
        .catch(e => {
          engine.log("An error during vote interval happened :/")
          engine.log(e.stack)
        })
    }, checkInterval)

  })
})