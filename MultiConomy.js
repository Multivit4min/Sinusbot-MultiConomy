registerPlugin({
  name: "MultiConomy",
  engine: ">= 0.13.37",
  version: "0.1.0",
  description: "Advanced Economy System",
  author: "Multivitamin <david.kartnaller@gmail.com",
  vars: [{
    name: "currency_sign",
    title: "Currency Name (Default: Coins)",
    type: "string",
    default: "Coins"
  },{
    name: "currency_name",
    title: "Currency Sign (Default: $)",
    type: "string",
    default: "$"
  },{
    name: "external_store",
    title: "Want to use a third party Store? Enter the filename of the Script here",
    type: "string",
    default: false
  }]
}, (_, config) => {

  const engine = require("engine")
  const backend = require("backend")
  const event = require("event")

  var store = null

  event.on("load", () => {
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
  })

  class TransActionError extends Error {
    constructor(...args) {
      super(...args)
    }
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
      var balance = {}
      uids.forEach(uid => {
        var funds = this.store.getInstance(`balance_${uid}`)
        balance[uid] = isNaN(funds) ? 0 : funds
      })
      return Promise.resolve(balance)
    }

    /**
     * Sets the balance of multiple uids to the given value
     * @async
     * @param {string[]} uids takes an array of uids as argument
     * @param {number} amount the amount which should be set
     * @returns {Promise} returns a Promise which resolves on success
     */
    setBalance(uids, amount) {
      uids.forEach(uid => this.store.setInstance(`balance_${uid}`, amount))
      return Promise.resolve()
    }

    /**
     * Adds balance to multiple uids
     * @async
     * @param {string[]} uids takes an array of uids as argument
     * @param {number} amount the amount which should be added
     * @returns {Promise} returns a Promise which resolves on success
     */
    addBalance(uids, amount) {
      var balance = {}
      uids.forEach(uid => {
        var funds = this.store.getInstance(`balance_${uid}`)
        this.store.setInstance(`balance_${uid}`, isNaN(funds) ? amount : funds+amount)
      })
      return Promise.resolve()
    }

    /**
     * Removes balance from multiple uids
     * @async
     * @param {string[]} uids takes an array of uids as argument
     * @param {number} amount the amount which should be removed
     * @returns {Promise} returns a Promise which resolves on success
     */
    removeBalance(uids, amount) {
      var balance = {}
      uids.forEach(uid => {
        var funds = this.store.getInstance(`balance_${uid}`)
        this.store.setInstance(`balance_${uid}`, isNaN(funds) ? amount*-1 : funds-amount)
      })
      return Promise.resolve()
    }

    /**
     * Retrieves the toplist of uids sorted by their balance
     * @async
     * @param {number} offset the offset from where the first user should be display
     * @param {number} limit the amount of users which should be retrieved
     * @returns {Promise} returns a Promise which resolves to an array of objects with uid and the balance amount
     */
    getTopList(offset = 0, limit = 10) {
      return new Promise((fulfill, reject) => {
        var result = this.store.getKeysInstance()
          .filter(key => /^balance_[\/+a-zA-Z0-9]{27}=$/.test(key))
          .map(key => {
            return {
              uid: key.match(/^balance_(?<uid>[\/+a-zA-Z0-9]{27}=)$/).groups.uid,
              balance: this.store.getInstance(key)
            }
          })
          .sort((a, b) => {
            if (a.balance < b.balance) return -1
            if (a.balance > b.balance) return 1
            return 0
          })
          .reverse()
          .slice(offset, limit)
        fulfill(result)
      })
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
      if (!/^[a-z0-9\/+]{27}=$/i.test(client)) 
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
   * A Fund transaction between two clients
   * @constructor
   * @param {object} store the store object from where transactions get handled
   */
  class Transaction {
    constructor(store) {
      this._store = store
      this._allowNegativebalance = false
      this._amount = 0
      this._receiver = null
      this._sender = null
    }

    /**
     * Sets the amount which should be transfered
     * @param {number} amount the amount of funds which should be transferred
     * @returns {this} returns this to make calls chainable
     */
    amount(amount) {
      if (typeof amount !== "number" || amount < 0) throw new Error("Amount should be a positive number")
      this._amount = amount
      return this
    }

    /**
     * Sets the Sender of the transaction, this client will get the funds removed
     * @param {client|string} client a sinusbot client or uid from where the balances should be removed
     * @returns {this} returns this to make calls chainable
     */
    sender(client) {
      this._sender = fetchUid(client)
      return this
    }

    /**
     * Sets the Receiver of the transaction, this client will get the funds added
     * @param {client|string} client a sinusbot client or uid where the balances should be added
     * @returns {this} returns this to make calls chainable
     */
    receiver(client) {
      this._receiver = fetchUid(client)
      return this
    }

    /**
     * Allows a negative Balance for the sender after this transaction
     * @param {boolean} [allow=true] set to true so the sender can get into a negative balance
     * @returns {this} returns this to make calls chainable
     */
    allowNegativeBalance(allow=true) {
      this._allowNegativebalance = allow
      return this
    }

    /**
     * Executes the transaction
     * @async
     * @returns {Promise} returns a Promise which resolves when successful
     */
    execute() {
      return new Promise(async (fulfill, reject) => {
        try {
          if (!this._allowNegativebalance) {
            var balance = (await this._store.getBalance([this._sender]))[this._sender]
            if (balance < this._amount) throw new TransActionError("Insufficent funds")
          }
          await Promise.all([
            this._store.addBalance([this._receiver], this._amount),
            this._store.removeBalance([this._sender], this._amount)
          ])
          fulfill()
        } catch (e) {
          reject(e)
        }
      })
    }

  }



  engine.export({
    /**
     * Retrieves the currency sign
     * @name getCurrencySign
     * @async
     * @returns {string} returns the set currency sign
     */
    getCurrencySign() {
      return config.currency_sign
    },
    /**
     * Retrieves the currency name
     * @name getCurrencyName
     * @async
     * @return {string} returns the currency name
     */
    getCurrencyName() {
      return config.currency_name
    },
    /** 
     * Retrieves the amount of money a client has
     * @name getBalance
     * @async
     * @param {client|string} client takes a Sinusbot Client Object or uid which should be looked up
     * @returns {Promise} returns a Promise object which returns the amount of money a client has
     */
    getBalance(client) {      
      return new Promise((fulfill, reject) => {
        var uid = fetchUid(client)
        store.getBalance([uid])
          .then(amount => fulfill(amount[uid]))
          .catch(reject)
      })
    },
    /**
     * Retrieves the amount of money multiple clients have
     * @name getBalances
     * @async
     * @param {client[]|string[]} clients takes a mix of Sinusbot Clients and uids which should be looked up
     * @returns {Promise} returns a Promise object with an object of all client uids and their balance
     */
    getBalances(clients) {
      if (!Array.isArray(clients)) clients = [clients]
      return store.getBalance(clients.map(fetchUid))
    },
    /**
     * Sets the balance of one or multiple Clients
     * @name setBalance
     * @async
     * @param {client[]|string[]} clients takes a mix of Sinusbot Clients and uids which should be set
     * @param {number} amount the balance which should be set
     * @returns {Promise} returns a Promise object which resolves on success
     */
    setBalance(clients, amount) {
      if (typeof amount !== "number") 
        return Promise.reject(new Error("Set Balance amount must be a number!"))
      if (!Array.isArray(clients)) clients = [clients]
      return store.setBalance(clients.map(fetchUid), amount)
    },
    /**
     * Adds the specified amount of money to one or multiple clients
     * @name addBalance
     * @async
     * @param {client[]|string[]} clients takes a mix of Sinusbot Clients and uids which should be set
     * @param {number} amount the balance which should be added
     * @returns {Promise} returns a Promise object which resolves on success
     */
    addBalance(clients, amount) {
      if (typeof amount !== "number" || amount < 0) 
        return Promise.reject(new Error("Add Balance amount must be a positive number!"))
      if (!Array.isArray(clients)) clients = [clients]
      return store.addBalance(clients.map(fetchUid), amount)
    },
    /**
     * Removes the specified amount of money to one or multiple clients
     * @name removeBalance
     * @async
     * @param {client[]|string[]} clients takes a mix of Sinusbot Clients and uids which should be set
     * @param {number} amount the balance which should be removed
     * @returns {Promise} returns a Promise object which resolves on success
     */
    removeBalance(clients, amount) {
      if (typeof amount !== "number" || amount < 0) 
        return Promise.reject(new Error("Add Balance amount must be a positive number!"))
      if (!Array.isArray(clients)) clients = [clients]
      return store.removeBalance(clients.map(fetchUid), amount)
    },
    /**
     * Retrieves the toplist of uids sorted by their balance
     * @name getTopList
     * @async
     * @param {number} offset the offset from where the first user should be display
     * @param {number} limit the amount of users which should be retrieved
     * @returns {Promise} returns a Promise which resolves to an array of objects with uid and the balance amount
     */
    getTopList(offset = 0, limit = 10) {
      return store.getTopList(offset, limit)
    },
    /**
     * Creates a Transaction between to clients
     * @name createTransaction
     * @returns {Transaction} returns a new Instance of Transaction
     */
    createTransaction() {
      return new Transaction(store)
    }
  })
})