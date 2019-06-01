/* global BigInt */
registerPlugin({
  name: "MultiConomy",
  engine: ">= 1.0.0",
  version: "0.2.0",
  description: "Advanced Economy System",
  author: "Multivitamin <david.kartnaller@gmail.com",
  vars: [{
    name: "currency_name",
    title: "Currency Name (Default: Coins)",
    type: "string",
    default: "Coins"
  }, {
    name: "currency_sign",
    title: "Currency Sign (Default: $)",
    type: "string",
    default: "$"
  }, {
    name: "external_store",
    title: "Want to use a third party Store? Enter the filename of the Script here",
    type: "string",
    default: false
  }, {
    name: "cache_disable",
    title: "Disable cache (disable cache when you access the same wallet store with multiple Sinusbot Instances)",
    type: "checkbox",
    default: 0
  }, {
    name: "dump",
    title: "Run database dump actions",
    type: "select",
    options: [
      "do nothing",
      "create backup from store",
      "get informations about the current backup",
      "export backup via console",
      "import a backup string",
      "load backup to store",
      "erase the current selected store"
    ],
    default: 0
  }, {
    name: "importb64",
    title: "BASE64 Import String",
    type: "string",
    conditions: [{ field: "dump", value: 4 }]
  }, {
    name: "confirm_restore",
    title: "Confirm that you want to restore the backup with 'CONFIRM RESTORE'",
    type: "string",
    conditions: [{ field: "dump", value: 5 }]
  }, {
    name: "confirm_wipe",
    title: "Confirm that you want to delete all data with 'CONFIRM ERASE'",
    type: "string",
    conditions: [{ field: "dump", value: 6 }]
  }]
}, (_, config) => {

  const engine = require("engine")
  const backend = require("backend")
  const event = require("event")

  let updateNickList = []
  let updateNickTimeout = null
  let store = null
  let bank = null

  /**
   * Creates a new Store class
   */
  class DefaultStore {
    constructor() {
      this._prefixBalance = "ecobalance_"
      this._prefixHistory = "ecohistory_"
      this._prefixNickname = "econickname_"
      this.store = require("store")
    }

    /**
     * Resets and wipes the complete Store except the dump
     * @async
     * @returns {Promise}
     */
    reset() {
      const prefix = [this._prefixBalance, this._prefixHistory, this._prefixNickname]
      this.store.getKeysInstance()
        .filter(key => prefix.some(p => key.startsWith(p)))
        .forEach(key => this.store.unsetInstance(key))
      return Promise.resolve()
    }

    /**
     * Retrieves the balance of multiple uids
     * @async
     * @param {string[]} uids takes an array of uids as argument
     * @returns {Promise} returns a Promise which resolves to an object with the uids as key and the balance as value
     */
    getBalance(uids) {
      const balance = {}
      uids.forEach(uid => {
        const funds = this.store.getInstance(`${this._prefixBalance}${uid}`)
        balance[uid] = isNaN(funds) ? 0 : funds
      })
      return Promise.resolve(balance)
    }

    /**
     * Retrieves the balance of all existing users in the db
     * @async
     * @returns {Promise} returns a Promise which resolves to an object with the uids as key and the balance as value
     */
    getAllBalances() {
      return Promise.resolve(this._fetchKeys(this._prefixBalance))
    }

    /**
     * Retrieves the transaction history of an uid
     * @async
     * @param {string} uid the uid for which the history should be retrieved
     * @param {number} limit the amount of entries which should be retrieved
     * @returns {Promise} returns a Promise which resolves to an object with the uids as key and the transaction array as value
     */
    getHistory(uid, limit) {
      const history = this.store.getInstance(`${this._prefixHistory}${uid}`)
      if (!Array.isArray(history)) return Promise.resolve([])
      return Promise.resolve(history.slice(history.length - limit, history.length))
    }

    /**
     * Retrieves the transaction history of an uid
     * @async
     * @returns {Promise} returns a Promise which resolves to an object with the uids as key and the transaction array as value
     */
    getAllHistory() {
      return Promise.resolve(this._fetchKeys(this._prefixHistory))
    }

    /**
     * Adds transaction to the transaction history of an uid
     * @async
     * @param {Object[]} data the transaction data which should be added
     * @param {string} data[].uid the uid from the owner of the transaction
     * @param {number} data[].change the value of how much the balance changed
     * @param {number} data[].date the date as Date.now() format
     * @param {string} data[].reason the reason text (max 255 chars)
     * @returns {Promise} returns a Promise which resolves on success
     */
    addHistory(data) {
      data.forEach(d => {
        const { uid, ...insert } = d
        let history = this.store.getInstance(`${this._prefixHistory}${uid}`)
        if (!Array.isArray(history)) history = []
        history.push(insert)
        this.store.setInstance(`${this._prefixHistory}${uid}`, history)
      })
      return Promise.resolve()
    }

    /**
     * Sets the balance of multiple uids to the given value
     * @async
     * @param {Object[]} data an array of objects
     * @param {string} data[].uid the uid of the client
     * @param {string} data[].balance the balance which should get saved
     * @returns {Promise} returns a Promise which resolves on success
     */
    setBalance(data) {
      Object.keys(data).forEach(k => this.store.setInstance(`${this._prefixBalance}${data[k].uid}`, data[k].balance))
      return Promise.resolve()
    }

    /**
     * Updates the nicknames and uid map
     * @param {object} list a list of uids as key and their nickname as value which should get updated and stored
     * @returns {Promise} returns a Promise which resolves on success
     */
    updateNicks(list) {
      Object
        .keys(list)
        .forEach(k => this.store.setInstance(`${this._prefixNickname}${k}`, list[k]))
      return Promise.resolve()
    }

    /**
     * retrieves multiple nicknames from cache
     * @param {array} uids a list of uids which should get resolved
     * @returns {Promise} returns a promise which resolves with the found nicknames, returns the uid if no nickname has been found
     */
    getNicknames(uids) {
      const result = {}
      uids.forEach(uid => {
        const nick = this.store.getInstance(`${this._prefixNickname}${uid}`)
        result[uid] = typeof nick === "string" ? nick : uid
      })
      return Promise.resolve(result)
    }

    /**
     * Retrieves the transaction history of an uid
     * @async
     * @returns {Promise} returns a Promise which resolves to an object with the uids as key and the transaction array as value
     */
    getAllNicknames() {
      return Promise.resolve(this._fetchKeys(this._prefixNickname))
    }

    /**
     * Fetches a specific type of keys
     * @private
     */
    _fetchKeys(prefix) {
      const res = {}
      this.store.getKeysInstance()
        .map(key => key.match(RegExp(`^${prefix}(?<uid>[a-z0-9/+]{27}=)$`, "i")))
        .filter(x => x !== null)
        .forEach(match => res[match[1]] = this.store.getInstance(match[0]))
      return res
    }

    /**
     * Retrieves the toplist of uids sorted by their balance
     * @async
     * @param {number} offset the offset from where the first user should be display
     * @param {number} limit the amount of users which should be retrieved
     * @returns {Promise} returns a Promise which resolves to a sorted array of objects with uid and the balance amount
     */
    getTopList(offset = 0, limit = 10) {
      const regex = new RegExp(`^${this._prefixBalance}(?<uid>[/+a-zA-Z0-9]{27}=|\\d{18})$`)
      return Promise.resolve(
        this.store.getKeysInstance()
          .filter(key => regex.test(key))
          .map(key => ({
            uid: key.match(regex).groups.uid,
            balance: this.store.getInstance(key)
          }))
          .sort((a, b) => {
            if (a.balance < b.balance) return -1
            if (a.balance > b.balance) return 1
            return 0
          })
          .reverse()
          .slice(offset, limit)
      )
    }

  }


  /**
   * creates a new wallet
   * @param {string} uid the uid to who the wallet belongs to
   * @param {bigint|number|string} balance the amount of funds a wallet has
   * @param {Bank} bankHandle the bank to which the wallet belongs to
   */
  class Wallet {
    constructor(bankHandle, uid, balance) {
      this._bank = bankHandle
      this._uid = uid
      this._balance = Wallet.convertToBigInt(balance)
      this._unsavedHistory = []
    }

    /**
     * Adds this wallet to the save queue
     * @private
     */
    _save() {
      this._bank.queueSave(this)
    }

    /**
     * Queues a history update
     * @param {bigint} change the amount which had changed
     * @param {string} reason the text wich should be used in the log
     */
    _addHistory(change, reason) {
      if (reason.length > 255) throw new Error("Reason length should not have more than 255 Chars!")
      this._unsavedHistory.push({
        change: String(change),
        date: Date.now(),
        reason
      })
    }

    /**
     * Converts a number to a BigInt, this will remove any floating point
     * @param {bigint|number|string} num the number which should be parsed to a bigint
     * @returns  {bigint} returns the converted bigint
     */
    static convertToBigInt(num) {
      switch (typeof num) {
        case "bigint":
          return num
        case "number":
          if (!Number.isSafeInteger(num)) {
            engine.log(`WARNING an unsafe integer is being converted! (${num})`)
            engine.log(`See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/MAX_SAFE_INTEGER for details`)
          }
          return BigInt(num)
        case "string":
          if (isNaN(num)) throw new Error("Non numeric string given")
          return BigInt(num)
        default: throw new Error(`Tried to convert unknown type ${typeof num} to BigInt!`)
      }
    }

    /**
     * Serializes the balace and uid of the Wallet
     * @returns {Object} returns a JSON.stringify able object
     */
    serializeBalance() {
      return {
        uid: this._uid,
        balance: String(this._balance)
      }
    }

    /**
     * clears and returns the transaction history
     * @private
     * @returns {Object[]} returns a JSON.stringify able object
     */
    getAndClearHistory() {
      const history = [...this._unsavedHistory]
      this._unsavedHistory = []
      return history.map(data => ({
        ...data,
        uid: this.getOwner()
      }))
    }

    /**
     * Checks if a user has enough funds to do a transaction
     * @param {bigint|number|string} amount checks if a user has the amount of funds
     * @returns {boolean} returns true when the user has at least as much funds
     */
    hasFunds(amount) {
      return this._balance >= Wallet.convertToBigInt(amount)
    }

    /**
     * Adds an amount of funds to the wallet
     * @param {bigint|number|string} amount  the amount of funds which should be added
     * @param {string} [reason] the reason which gets logged inside the transaction history
     * @returns {Wallet} returns this to chain functions
     */
    addBalance(amount, reason = "") {
      amount = Wallet.convertToBigInt(amount)
      this._addHistory(amount, reason)
      this._balance += amount
      this._save()
      return this
    }

    /**
     * Sets the amount of funds in the wallet
     * @param {bigint|number|string} amount  the amount of funds which should be set
     * @param {string} [reason] the reason which gets logged inside the transaction history
     * @returns {Wallet} returns this to chain functions
     */
    setBalance(amount, reason = "") {
      amount = Wallet.convertToBigInt(amount)
      this._addHistory(amount - this._balance, reason)
      this._balance = amount
      this._save()
      return this
    }

    /**
     * Removes an amount of funds from the wallet
     * @param {bigint|number|string} amount  the amount of funds which should be removed
     * @param {string} [reason] the reason which gets logged inside the transaction history
     * @returns {Wallet} returns this to chain functions
     */
    removeBalance(amount, reason = "") {
      amount = Wallet.convertToBigInt(amount)
      this._addHistory(amount * BigInt(-1), reason)
      this._balance -= amount
      this._save()
      return this
    }

    /**
     * Retrieve the current balance
     * @returns {string} returns the current balance as string
     */
    getBalance() {
      return String(this._balance)
    }

    /**
     * Retrieve the owner of the wallet
     * @returns {string} returns the uid of the wallet owner
     */
    getOwner() {
      return this._uid
    }

    /**
     * Retrieves the transaction history
     * @async
     * @param {number} [limit=25] the amount of entries which should get retrieved
     * @returns {Promise[]} returns a Promise which has an array with the last n transactions
     */
    async getHistory(limit = 25) {
      const length = this._unsavedHistory.length
      if (limit <= length) return this._unsavedHistory.slice(length - limit, length)
      const data = await this._bank.getHistory(this.getOwner(), limit - length)
      data.push(...this._unsavedHistory)
      return data
    }
  }


  /**
   * Adds a client to the update queue
   * @private
   * @param {client} client the sinusbot client which nickname should be updated
   */
  function pushNickQueue(client) {
    if (updateNickList.some(c => c.uid() === client.uid())) return
    updateNickList.push(client)
    clearTimeout(updateNickTimeout)
    updateNickTimeout = setTimeout(() => {
      if (updateNickList.length === 0) return
      const save = updateNickList.map(r => r)
      const update = {}
      updateNickList = []
      save.forEach(c => update[c.uid()] = c.nick())
      store.updateNicks(update)
        .catch(e => {
          engine.log(e.stack)
          engine.log("Updating Nicklist failed!")
          save.forEach(pushNickQueue)
        })
    }, 500)
  }


  /**
   * Resolves the input to a uid
   * @private
   * @param {client|string} client the sinusbot client or uid
   * @returns {string} returns the resolved uid
   */
  function fetchUid(client) {
    if (typeof client === "string") {
      if (!(/^([a-z0-9/+]{27}=|\d{18})$/i).test(client))
        throw new Error(`Missmatch, expected a uid matching ([a-z0-9\\/+]{27}=|\\d{18})`)
      return client
    }
    if (typeof client === "object") {
      if (typeof client.uid !== "function")
        throw new Error(`Expected client.uid to be a function but got ${typeof client.uid}`)
      switch (engine.getBackend()) {
        case "ts3": return client.uid()
        case "discord": return client.uid().split("/")[1]
        default: throw new Error(`Unknown Backend ${engine.getBackend()}`)
      }
    }
    throw new Error(`Expected a string or object but got ${typeof client}`)
  }


  /**
   * Bank manages wallets of multiple users
   * @constructor
   * @param {object} storeHandle the store object from where transactions get handled
   * @param {object} saveInterval timeout until data gets saved to the store
   */
  class Bank {
    constructor(storeHandle, saveInterval) {
      this._store = storeHandle
      this._wallets = []
      this._saveQueue = []
      this._saveInterval = saveInterval
      this._saveTimeout = null
    }

    /**
     * Adds a new wallet to the saving Queue
     * @param {Wallet} wallet the wallet which should get saved
     */
    queueSave(wallet) {
      clearTimeout(this._saveTimeout)
      this._saveTimeout = setTimeout(() => this.flushQueue(), this._saveInterval)
      if (this._saveQueue.includes(wallet)) return
      this._saveQueue.push(wallet)
    }

    /**
     * Forces the save of all wallets in the queue
     */
    flushQueue() {
      clearTimeout(this._saveTimeout)
      if (this._saveQueue.length === 0) return
      const history = []
      this._saveQueue.forEach(wallet => history.push(...wallet.getAndClearHistory()))
      Promise.all([
        this._store.setBalance(this._saveQueue.map(wallet => wallet.serializeBalance())),
        this._store.addHistory(history)
      ]).catch(e => {
        engine.log("Failed to store balance and/or history!")
        engine.log(e.stack)
      })
      this._saveQueue = []
    }

    /**
     * Tries to get the wallet from cache
     * @private
     * @param {string} uid the uid from the wallet owner
     * @returns {Wallet} returns the cached wallet if found, otherwise null
     */
    _getWalletFromCache(uid) {
      return this._wallets.find(wallet => wallet.getOwner() === uid)
    }

    /**
     * Creates a wallet and returns it
     * @param  {...any} args the arguments which will passed to the Wallet constructor
     * @returns {Wallet} returns the created wallet
     */
    _createWallet(...args) {
      const wallet = new Wallet(bank, ...args)
      if (this._saveInterval > 0) this._wallets.push(wallet)
      return wallet
    }

    /**
     * Retrieves a wallet instance of the owner with the given uid
     * @param {string} uid the uid from who the wallet should get retrieved
     * @returns {Promise} fulfills with the Wallet of the given uid
     */
    getWallet(uid) {
      const wallet = this._getWalletFromCache(uid)
      if (wallet instanceof Wallet) return Promise.resolve(wallet)
      return store.getBalance([uid])
        .then(balance => Promise.resolve(this._createWallet(uid, balance[uid])))
    }

    /**
     * Retrieves the transaction history of a uid
     * @async
     * @param {string} uid the uid for which the history should be retrieved
     * @param {number} limit the amount of entries which should be retrieved
     * @returns {Promise} returns a Promise which resolves to an object with the uids as key and the transaction array as value
     */
    getHistory(uid, limit) {
      return this._store.getHistory(uid, limit)
    }
  }

  event.on("load", async () => {
    //load the store if one had been set
    if (config.external_store !== false) {
      try {
        engine.log(`Trying to load external Store Plugin ${config.external_store}`)
        store = await require(config.external_store)()
      } catch (e) {
        engine.log(`Could not load external Store Plugin for MultiConomy!`)
        engine.log(e.stack)
      }
    }
    if (store === null) {
      engine.log("Loading Default Store")
      store = new DefaultStore()
    }

    bank = new Bank(store, config.cache_disable ? 0 : 10 * 1000)
    //register handler for nick updates
    backend.getClients().map(pushNickQueue)
    event.on("clientNick", client => store.updateNicks({ [client.uid()]: client.nick()}))
    event.on("clientMove", ev => {
      if (ev.fromChannel !== null) return
      pushNickQueue(ev.client)
    })

    //Database dump actions
    if (parseInt(config.dump, 10) > 0) {
      const type = parseInt(config.dump, 10)
      config.dump = "0"
      // eslint-disable-next-line camelcase
      config.confirm_wipe = ""
      // eslint-disable-next-line camelcase
      config.confirm_restore = ""
      engine.saveConfig(config)
      const start = Date.now()
      //CREATE DUMP
      if (type === 1) {
        engine.log("Running Backup actions! This may take a while...")
        const [balances, history, nicknames] = await Promise.all([
          store.getAllBalances(),
          store.getAllHistory(),
          store.getAllNicknames()
        ])
        require("store").setInstance("__ecodump__", {
          date: Date.now(), balances, history, nicknames
        })
        engine.log(`Backup done in ${Date.now()-start}ms`)
      //LOG DUMP STATUS
      } else if (type === 2) {
        const dump = require("store").getInstance("__ecodump__")
        if (!dump) return engine.log("no saved dump found!")
        engine.log(`dump created on ${new Date(dump.date)}`)
      //LOG BASE64 DUMP
      } else if (type === 3) {
        const dump = require("store").getInstance("__ecodump__")
        if (!dump) return engine.log("no saved dump found!")
        engine.log("Creating base64 encoded dump...")
        const marker = Array(60).fill("=").join("")
        const base64 = require("helpers").base64Encode(JSON.stringify(dump))
        engine.log(`\r\nCOPY BELOW ${marker}\r\n${base64}\r\nCOPY ABOVE ${marker}`)
      //IMPORT BASE64 DUMP
      } else if (type === 4) {
        engine.log("Importing BASE64 String...")
        const base64 = require("helpers").base64Decode(config.importb64)
        if (typeof base64 !== "string") return engine.log("Corrupt base64 detected! Aborting")
        require("store").setInstance("__ecodump__", JSON.parse(base64))
        engine.log("Done")
      //WRITE DUMP TO STORE
      } else if (type === 5) {
        engine.log("Restoring last backup!")
        if (config.confirm_restore !== "CONFIRM RESTORE")
          return engine.log("REFUSING TO RESTORE, INVALID CONFIRMATION GIVEN!")
        const dump = require("store").getInstance("__ecodump__")
        if (!dump) return engine.log("no saved dump found!")
        const { date, balances, history, nicknames } = dump
        engine.log(`Restoring dump from ${new Date(date)}! This may take a while...`)
        engine.log("(1/4): Wiping Store...")
        await store.reset()
        engine.log("(2/4): Adding Balances...")
        await store.setBalance(Object.keys(balances).map(uid => ({
          uid, balance: dump.balances[uid]
        })))
        engine.log("(3/4): Adding History...")
        const add = []
        Object.keys(history).forEach(uid => {
          add.push(...history[uid].map(data => ({ uid, ...data })))
        })
        await store.addHistory(add)
        engine.log(`(4/4): Adding Nicknames...`)
        await store.updateNicks(nicknames)
        engine.log(`Restore done in ${Date.now()-start}ms!`)
      //WIPE EVERYTHING
      } else if (type === 6) {
        engine.log("Restoring last backup!")
        if (config.confirm_wipe !== "CONFIRM WIPE")
          return engine.log("REFUSING TO WIPE, INVALID CONFIRMATION GIVEN!")
        engine.log("Wiping Store...")
        await store.reset()
        engine.log(`Wipe done in ${Date.now()-start}ms!`)
      }
    }
  })

  event.on("unload", () => {
    //nothing to save
    if (bank === null) return
    //flush all changed wallets to disk
    bank.flushQueue()
  })


  engine.export({

    /**
     * Retrieves the currency sign
     * @async
     * @returns {string} returns the set currency sign
     */
    getCurrencySign() {
      return config.currency_sign
    },

    /**
     * Retrieves the currency name
     * @async
     * @return {string} returns the currency name
     */
    getCurrencyName() {
      return config.currency_name
    },

    /**
     * Retrieves a wallet from a client
     * BEWARE, never cache the wallet on your side, always request a new wallet
     * @param {client|string} client takes a Sinusbot Client Object or uid which should be looked up
     * @returns {Promise} returns a Promise object which resolves to the wallet
     */
    getWallet(client) {
      return bank.getWallet(fetchUid(client))
    },

    /**
     * Retrieves the amount of money a client has
     * @async
     * @param {client|string} client takes a Sinusbot Client Object or uid which should be looked up
     * @returns {Promise} returns a Promise object which returns the amount of money a client has
     */
    getBalance(client) {
      return new Promise((fulfill, reject) => {
        const uid = fetchUid(client)
        store.getBalance([uid])
          .then(amount => fulfill(amount[uid]))
          .catch(reject)
      })
    },

    /**
     * Retrieves the amount of money multiple clients have
     * @async
     * @param {client[]|string[]} clients takes a mix of Sinusbot Clients and uids which should be looked up
     * @returns {Promise} returns a Promise object with an object of all client uids, nickname and their balance
     */
    getBalances(clients) {
      if (!Array.isArray(clients)) clients = [clients]
      return store.getBalance(clients.map(fetchUid))
    },

    /**
     * Retrieves the toplist of uids sorted by their balance
     * @async
     * @param {number} offset the offset from where the first user should be display
     * @param {number} limit the amount of users which should be retrieved
     * @returns {Promise} returns a Promise which resolves to an array of objects with uid and the balance amount
     */
    getTopList(offset = 0, limit = 10) {
      let topList = []
      return store.getTopList(offset, limit)
        .then(list => ((topList = list, store.getNicknames(list.map(r => r.uid)))))
        .then(nicks => topList.map(e => ((e.nick = nicks[e.uid], e))))
    }
  })


})