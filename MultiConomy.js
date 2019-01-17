/* eslint-disable no-async-promise-executor */
/* eslint-disable no-undef */
registerPlugin({
  name: "MultiConomy",
  engine: ">= 0.13.37",
  version: "0.1.0",
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
    }

    /**
     * Adds this wallet to the save queue
     */
    _save() {
      this._bank.queueSave(this)
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
            engine.log(`WARNING a unsafe integer is being converted! (${num})`)
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
     * @returns {Object} returns a JSON.stringify able object 
     */
    serialize() {
      return {
        uid: this.uid,
        balance: String(this.balance)
      }
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
     * @returns {Wallet} returns this to chain functions
     */
    addBalance(amount) {
      this._balance += Wallet.convertToBigInt(amount)
      this._save()
      return this
    }

    /**
     * Sets the amount of funds in the wallet
     * @param {bigint|number|string} amount  the amount of funds which should be set
     * @returns {Wallet} returns this to chain functions
     */
    setBalance(amount) {
      this._balance = Wallet.convertToBigInt(amount)
      this._save()
      return this
    }

    /**
     * Removes an amount of funds from the wallet
     * @param {bigint|number|string} amount  the amount of funds which should be removed
     * @returns {Wallet} returns this to chain functions
     */
    removeBalance(amount) {
      this._balance -= Wallet.convertToBigInt(amount)
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
  }


  /**
   * Adds a client to the update queue
   * @private
   * @param {client} 
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
   * Creates a new Store class
   * @constructor
   */
  class DefaultStore {
    constructor() {
      this.store = require("store")
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
        const funds = this.store.getInstance(`balance_${uid}`)
        balance[uid] = isNaN(funds) ? 0 : funds
      })
      return Promise.resolve(balance)
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
      Object.keys(data).forEach(k => this.store.setInstance(`balance_${data[k].uid}`, data[k].balance))
      return Promise.resolve()
    }

    /** 
     * Updates the nicknames and uid map
     * @param {object} list a list of uids as key and their nickname which should get updated and stored
     * @returns {Promise} returns a Promise which resolves on success
     */
    updateNicks(list) {
      Object
        .keys(list)
        .forEach(k => this.store.setInstance(`nickname_${k}`, list[k]))
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
        const nick = this.store.getInstance(`nickname_${uid}`)
        result[uid] = typeof nick === "string" ? nick : uid
      })
      return Promise.resolve(result)
    }

    /**
     * Retrieves the toplist of uids sorted by their balance
     * @async
     * @param {number} offset the offset from where the first user should be display
     * @param {number} limit the amount of users which should be retrieved
     * @returns {Promise} returns a Promise which resolves to a sorted array of objects with uid and the balance amount
     */
    getTopList(offset = 0, limit = 10) {
      return Promise.resolve(this.store.getKeysInstance()
          .filter(key => (/^balance_[/+a-zA-Z0-9]{27}=$/).test(key))
          .map(key => ({
            uid: key.match(/^balance_(?<uid>[/+a-zA-Z0-9]{27}=)$/).groups.uid,
            balance: this.store.getInstance(key)
          }))
          .sort((a, b) => {
            if (a.balance < b.balance) return -1
            if (a.balance > b.balance) return 1
            return 0
          })
          .reverse()
          .slice(offset, limit))
    }
    
  }

  /**
   * Resolves the input to a uid 
   * @private
   * @param {client|string} client the sinusbot client or uid
   * @returns {string} returns the resolved uid
   */
  function fetchUid(client) {
    if (typeof client === "string") {
      if (!(/^[a-z0-9/+]{27}=$/i).test(client)) 
        throw new Error(`Missmatch, expected a uid matching [a-z0-9\\/+]{27}=`)
      return client
    }
    if (typeof client === "object") {
      if (typeof client.uid !== "function")
        throw new Error(`Expected client.uid to be a function but got ${typeof client.uid}`)
      return client.uid()
    }
    throw new Error(`Expected a string or object but got ${typeof client}`)
  }


  /**
   * Bank manages wallets of multiple users
   * @constructor
   * @param {object} storeHandle the store object from where transactions get handled
   */
  class Bank {
    constructor(storeHandle) {
      this._store = storeHandle
      this._wallets = []
      this._saveQueue = []
      this._saveTimeout = null
    }

    /**
     * Adds a new wallet to the saving Queue
     * @param {Wallet} wallet the wallet which should get saved 
     */
    queueSave(wallet) {
      clearTimeout(this._saveTimeout)
      this._saveTimeout = setTimeout(() => this.flushQueue(), 1000)
      this._saveQueue.push(wallet)
    }

    /**
     * Forces the save of all wallets in the queue
     */
    flushQueue() {
      clearTimeout(this._saveTimeout)
      if (this._saveQueue.length === 0) return
      this._store.setBalance(this._saveQueue.map(wallet => wallet.serialize()))
      this._saveQueue = []
    }

    /**
     * Tries to get the wallet from cache
     * @private
     * @param {string} uid 
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
      this._wallets.push(wallet)
      return wallet
    }

    /**
     * 
     * @param {string} uid the uid from who the wallet should get retrieved
     * @returns {Promise} fulfills with the Wallet of the given uid
     */
    getWallet(uid) {
      const wallet = this._getWalletFromCache(uid)
      if (wallet instanceof Wallet) return Promise.resolve(wallet)
      return store.getBalance([uid])
        .then(balance => Promise.resolve(this._createWallet(uid, balance[uid])))
    }
  }

  event.on("load", () => {
    //load the store if one had been set
    if (config.external_store !== false) {
      try {
        engine.log(`Trying to load external Store Plugin ${config.external_store}`)
        store = require(config.external_store)()
      } catch (e) {
        engine.log(`Could not load external Plugin `)
      }
    }
    if (store === null) {
      engine.log("Loading Default Store")
      store = new DefaultStore()
    }
  
    bank = new Bank(store)
    //register handler for nick updates
    backend.getClients().map(pushNickQueue)
    event.on("clientNick", ({client}) => store.updateNicks({ [client.uid()]: client.nick()}))
    event.on("clientMove", ev => {
      if (ev.fromChannel !== null) return
      pushNickQueue(ev.client)
    })
  })

  event.on("load", () => {
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