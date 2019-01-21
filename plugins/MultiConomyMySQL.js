/* eslint-disable lines-around-comment */
/* eslint-disable function-paren-newline */
/* eslint-disable no-multi-str */
/* eslint-disable arrow-body-style */
/* eslint-disable no-async-promise-executor */
registerPlugin({
  name: "MultiConomy MySQL Extension",
  engine: ">= 0.13.37",
  version: "0.1.0",
  description: "Database Extension for Multiconomy",
  author: "Multivitamin <david.kartnaller@gmail.com",
  requiredModules: ["db"],
  vars: [{
    name: "host",
    title: "MySQL Host/IP",
    type: "string",
    default: "127.0.0.1"
  }, {
    name: "username",
    title: "MySQL username",
    type: "string",
    default: ""
  }, {
    name: "password",
    title: "MySQL password",
    type: "string",
    default: ""
  }, {
    name: "database",
    title: "Database name",
    type: "string",
    default: ""
  }]
}, (_, config) => {

  const engine = require("engine")
  const db = require("db")

  function intArrayToString(array) {
    return array.map(a => String.fromCharCode(a)).join("")
  }

  class MySQLPromise {
    constructor(dbconfig) {
      this._mysqlConfig = { drive: "mysql", ...dbconfig }
      this._db = null
    }

    isConnected() {
      return this._db !== null
    }

    connect() {
      return new Promise((fulfill, reject) => {
        this._db = db.connect(this._mysqlConfig, err => {
          if (err) return reject(new Error(err))
          fulfill(this)
        })
      })  
    }

    query(...params) {
      return new Promise((fulfill, reject) => {
        if (!this.isConnected()) return reject(new Error("No connection to Database"))
        this._db.query(...params, (err, res) => err ? reject(new Error(err)) : fulfill(res))
      })
    }

    exec(...params) {
      return new Promise((fulfill, reject) => {
        if (!this.isConnected()) return reject(new Error("No connection to Database"))
        this._db.excec(...params, (err, res) => err ? reject(new Error(err)) : fulfill(res))
      })
    }
  }


  /**
   * Creates a new Store class
   * @constructor
   */
  class MySQLStore extends MySQLPromise {
    constructor(dbconfig) {
      super(dbconfig)
    }

    connect() {
      return new Promise((fulfill, reject) => {
        super.connect()
          .then(() => this.query(
            "CREATE TABLE IF NOT EXISTS `balances` (\
            `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,\
            `uid` VARCHAR(50) NOT NULL,\
            `balance` BIGINT NOT NULL DEFAULT '0',\
            `nickname` VARCHAR(50) NOT NULL DEFAULT '0',\
            PRIMARY KEY (`id`),\
            UNIQUE INDEX (`uid`),\
            INDEX (`balance`))"
          ))
          .then(() => this.query(
            "CREATE TABLE IF NOT EXISTS `history` (\
            `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,\
            `uid` VARCHAR(50) NOT NULL,\
            `change` BIGINT NOT NULL,\
            `reason` VARCHAR(255) NOT NULL,\
            `date` INT UNSIGNED NOT NULL,\
            PRIMARY KEY (`id`),\
            INDEX (`uid`, `date`))"
          ))
          .then(() => fulfill())
          .catch(reject)
      })
    }

    /**
     * Retrieves the balance of multiple uids
     * @async
     * @param {string[]} uids takes an array of uids as argument
     * @returns {Promise} returns a Promise which resolves to an object with the uids as key and the balance as value
     */
    getBalance(uids) {
      return new Promise((fulfill, reject) => {
        super.query(`SELECT uid, balance FROM balances WHERE uid IN (${Array(uids.length).fill("?").join(",")})`, ...uids)
          .then(res => {
            const balance = {}
            uids.forEach(uid => {
              balance[uid] = 0
              const data = res.find(r => intArrayToString(r.uid) === uid)
              if (data) balance[uid] = data.balance.toString()
            })
            fulfill(balance)
          })
          .catch(reject)
      })
    }

    /**
     * Retrieves the transaction history of a uid
     * @async
     * @param {string} uid the uid for which the history should be retrieved
     * @param {number} limit the amount of entries which should be retrieved
     * @returns {Promise} returns a Promise which resolves to an object with the uids as key and the transaction array as value
     */
    getHistory(uid, limit) {
      return new Promise((fulfill, reject) => {
        super.query(`SELECT \`change\`, date, reason FROM history WHERE uid = ? LIMIT ?`, uid, limit)
          .then(res => fulfill(res.map(r => ({
            change: r.change.toString(),
            date: parseInt(r.date, 10),
            reason: intArrayToString(r.reason)
          }))))
          .catch(reject)
      })
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
      const insert = []
      data.forEach(d => insert.push(d.uid, d.change, Math.floor(d.date/1000), d.reason))
      return super.query(
        `INSERT INTO history (uid, \`change\`, date, reason) VALUES ${Array(data.length).fill("(?,?,?,?)").join(",")}`,
        ...insert
      )
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
      const args = []
      data.forEach(({ uid, balance }) => args.push(uid, balance))
      return super.query(
        `INSERT INTO balances (uid, balance) VALUES ${Array(data.length).fill("(?,?)").join(",")} ON DUPLICATE KEY UPDATE balance = VALUES(balance)`,
        ...args
      )
    }

    /** 
     * Updates the nicknames and uid map
     * @param {object} list a list of uids as key and their nickname as value which should get updated and stored
     * @returns {Promise} returns a Promise which resolves on success
     */
    updateNicks(list) {
      const args = []
      Object.keys(list).forEach(uid => args.push(uid, list[uid]))
      return super.query(
        `INSERT INTO balances (uid, nickname) VALUES ${Array(Object.keys(list).length).fill("(?,?)").join(",")} ON DUPLICATE KEY UPDATE nickname = VALUES(nickname)`,
        ...args
      )
    }

    /**
     * retrieves multiple nicknames from cache
     * @param {array} uids a list of uids which should get resolved
     * @returns {Promise} returns a promise which resolves with the found nicknames, returns the uid if no nickname has been found
     */
    getNicknames(uids) {
      return new Promise((fulfill, reject) => {
        super.query(`SELECT uid, nickname FROM balances WHERE uid IN (${Array(uids.length).fill("?").join(",")})`, ...uids)
          .then(res => {
            const nicks = {}
            uids.forEach(uid => {
              nicks[uid] = uid
              const data = res.find(r => intArrayToString(r.uid) === uid)
              if (data) nicks[uid] = intArrayToString(data.nickname)
            })
            fulfill(nicks)
          })
          .catch(reject)
      })
    }

    /**
     * Retrieves the toplist of uids sorted by their balance
     * @async
     * @param {number} offset the offset from where the first user should be display
     * @param {number} limit the amount of users which should be retrieved
     * @returns {Promise} returns a Promise which resolves to a sorted array of objects with uid and the balance amount
     */
    // eslint-disable-next-line no-inline-comments
    getTopList(/*offset = 0, limit = 10*/) {
      return Promise.reject(new Error("Not implemented"))
      /*return Promise.resolve(this.store.getKeysInstance()
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
      */
    }
    
  }


  engine.export(() => {
    return new Promise(async (fulfill, reject) => {
      try{
        const mysql = new MySQLStore(config)
        await mysql.connect()
        fulfill(mysql)
      } catch(e) {
        reject(e)
      }
    })
  })


})