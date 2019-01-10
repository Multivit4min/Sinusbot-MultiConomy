In order to load this library you need to wait for `event#load` to get fired
After this you can import the library with `require("MultiConomy")`

```javascript
  const engine = require("engine")
  const event = require("event")

  //this makes sure that all scripts have finnished loading
  event.on("load", () => {
    //try to load the library
    const eco = require("MultiConomy")
    //check if the library has been loaded successfully
    if (!eco) throw new Error("MultiConomy.js library not found! Please download MultiConomy.js and enable it to be able use this script!")

    //start writing your scripts here
    engine.log(`MultiConomy currency name is ${eco.getCurrencyName()}`)
  })
```