# Interledger.js Documentation

# Contents
The `documentation` directory should contain docs outside the scope of the root directory's readme, particularly information describing architecture for specific plugins and components of the connector. Conversely, any docs related to setting up and configuring a connector should belong in the root directory.

`api-spec` directory contains openapi standard yaml specifications for the connector admin api, as well as any future api that will be implemented

# API Specification

## Setup
Suggestions on how to use the yaml open api spec in a browser

### Swaggerhub
Copy yaml file into a new [swaggerhub](https://swagger.io/tools/swaggerhub/) project, and publish.


V.2 Of the Connector Admin API is hosted here:
https://app.swaggerhub.com/apis-docs/Interledger/ConnectorJS-Admin-API/0.2


### Redocly

For a cleaner look, host the yaml config on github pages using Redocly's repo tool:
https://github.com/Redocly/create-openapi-repo#generator-openapi-repo--


## Future Content

- [ ] Reference section from ./README.md
- [ ] More extensive development guidelines
- [ ] Admin API Hosted on Redocly