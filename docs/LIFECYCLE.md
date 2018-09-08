## component lifecycle

#### server startup

when the pydgeon blueprint initializes, it reads all classes that inherit from
Component and verifies that their packages can be built.

#### during a request

* render page on server
  * fetch data
  * render components using data
  * place components in templates
  * add relationships between components
* send to client

#### client

* receive HTML for page, load prelude.js and prelude.css
* reinstantiate components
  * display component HTML (if no CSS required)
  * load component requires
  * load component refs
  * instantiate component
  * display component HTML (if CSS required)
  * notify others that this ref has been created


#### after interaction

* client makes RPC call to server with args
* server makes RPC call to client with response