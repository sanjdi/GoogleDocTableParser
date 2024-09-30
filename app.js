import https from 'https';
import { JSDOM } from 'jsdom';
import readline from 'node:readline';

class GoogleDocTableParser {
  nodeFetch = async (url) => {
    return new Promise((resolve, reject) => {
      // Use https.get() to fetch the google doc
      const req = https
        .get(url, (res) => {
          const { statusCode } = res;
          const contentType = res.headers['content-type'];

          // console.log('statusCode= ', statusCode);
          // console.log('contentType= ', contentType);

          let error;
          // Any 2xx status code signals a successful response but
          // here we're only checking for 200.
          if (statusCode !== 200) {
            error = new Error(
              'Request Failed.\n' + `Status Code: ${statusCode}`
            );
          } else if (!/^text\/html/.test(contentType)) {
            error = new Error(
              'Invalid content-type.\n' +
                `Expected text/html but received ${contentType}`
            );
          }
          if (error) {
            console.error(error.message);
            s;
            // Consume response data to free up memory
            res.resume();
            return;
          }

          res.setEncoding('utf8');
          let rawData = '';
          res.on('data', (chunk) => {
            rawData += chunk;
          });
          res.on('end', () => {
            resolve(rawData);
          });
        })
        .on('error', (e) => {
          console.error(`Got error: ${e.message}`);
        });

      req.on('error', reject);

      req.end();
    });
  };

  htmlTableToJSON(inputString) {
    // Parse the HTML string into a DOM object
    const dom = new JSDOM(inputString);
    const document = dom.window.document;

    // Find the table and tbody elements
    const table = document.querySelector('table');
    const tbody = table ? table.querySelector('tbody') : null;

    // Initialize the output JSON structure
    const jsonOutput = {
      status: 'ok',
      table: {
        cols: [],
        rows: [],
        parsedNumHeaders: 0,
      },
    };

    if (tbody) {
      // Extract headers from the first row
      const headers = Array.from(
        tbody.querySelectorAll('tr:first-child td')
      ).map((td) => td.textContent.trim());

      // Add header columns to JSON output
      if (headers.length) {
        jsonOutput.table.cols = headers.map((header, index) => ({
          id: String.fromCharCode(65 + index),
          label: header,
          type: index === 0 || index === 2 ? 'number' : 'string',
          pattern: index === 0 || index === 2 ? 'General' : undefined,
        }));
        jsonOutput.table.parsedNumHeaders = 0;
      }

      // Extract data rows
      const rows = tbody.querySelectorAll('tr:not(:first-child)');
      jsonOutput.table.rows = Array.from(rows).map((row) => {
        const cells = Array.from(row.querySelectorAll('td')).map((td) => {
          const text = td.textContent.trim();
          const value = parseFloat(text);
          return {
            v: isNaN(value) ? text : value,
            f: isNaN(value) ? undefined : text,
          };
        });
        return { c: cells };
      });
    }

    return jsonOutput;
  }

  async getGoogleDocTableDataUsingNodeFetch(url) {
    if (!url) return null;

    try {
      // Fetch google doc as a html string
      const rawData = await this.nodeFetch(url);

      if (rawData) {
        try {
          // Extract the first <table>..</table>
          const [tableRawData, _] = rawData.match(/(<table)[\s\S]+(\/table>)/);

          // Parse table data to a json object with required format
          const parsedJSON = this.htmlTableToJSON(tableRawData);
          // console.log('parsedJSON= ', JSON.stringify(parsedJSON, null, 2));

          return parsedJSON ? parsedJSON : null;
        } catch (e) {
          console.error(e.message);
        }
      }
      return null;
    } catch (e) {
      console.error('Error fetching spreadsheet data:', e);
      return null;
    }
  }

  normalizeRow(rows) {
    return rows.map((row) =>
      row && row.v !== null && row.v !== undefined ? row : {}
    );
  }

  applyHeaderIntoRows(header, rows) {
    return rows
      .map(({ c: row }) => this.normalizeRow(row))
      .map((row) =>
        row.reduce(
          (p, c, i) =>
            c.v !== null && c.v !== undefined
              ? Object.assign(p, {
                  [header[i]]: this.useFormat
                    ? c.f || c.v
                    : this.useFormattedDate && this.isDate(c.v)
                    ? c.f || c.v
                    : c.v,
                })
              : p,
          {}
        )
      );
  }

  getItems(parsedJSON) {
    let rows = [];

    try {
      // console.log('parsedJSON= ', JSON.stringify(parsedJSON));

      const hasSomeLabelPropertyInCols = parsedJSON.table.cols.some(
        ({ label }) => !!label
      );
      if (hasSomeLabelPropertyInCols) {
        const header = parsedJSON.table.cols.map(({ label }) => label);

        rows = this.applyHeaderIntoRows(header, parsedJSON.table.rows);
      } else {
        const [headerRow, ...originalRows] = parsedJSON.table.rows;
        const header = this.normalizeRow(headerRow.c).map((row) => row.v);

        rows = this.applyHeaderIntoRows(header, originalRows);
      }
    } catch (e) {
      console.error('Error parsing google doc data:', e);
    }

    return rows;
  }

  async parse(url) {
    if (!url) throw new Error('Url is required.');

    // Extract data from the first <table>..</table> of the google doc
    const googleDocResponse = await this.getGoogleDocTableDataUsingNodeFetch(
      url
    );

    // console.log('googleDocResponse= ' + JSON.stringify(googleDocResponse));

    if (googleDocResponse === null) return [];

    // Format table data to required structure for display
    return this.getItems(googleDocResponse);
  }
}

function showMessage(data) {
  // console.log('Successfully processed ' + data.length + ' rows!');
  // console.log('Data=' + JSON.stringify(data));

  // Find maximum x and y coordinate values in the data set
  const { 'x-coordinate': maxX } = data.reduce((prev, current) =>
    prev && prev['x-coordinate'] > current['x-coordinate'] ? prev : current
  );
  const { 'y-coordinate': maxY } = data.reduce((prev, current) =>
    prev && prev['y-coordinate'] > current['y-coordinate'] ? prev : current
  );

  // Iterate the data set
  for (let y = maxY; y >= 0; y--) {
    let row = '';
    // ...and build the message row by row
    for (let x = 0; x <= maxX; x++) {
      let found = data.find((item) => {
        if (
          item['y-coordinate'] === y &&
          item['x-coordinate'] === x &&
          item['Character'] != ''
        ) {
          return true;
        }
        return false;
      });

      if (found) {
        row += found['Character'];
      } else {
        row += ' ';
      }
      if (x === maxX) {
        // ...then print the row
        console.log(row);
        row = '';
      }
    }
  }
}

function decodeSecretMessage(url) {
  const parser = new GoogleDocTableParser();
  parser.parse(url).then((data) => showMessage(data));
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question(`What's the google doc url?`, (url) => {
  console.log('The secret message is...');
  decodeSecretMessage(url);
  rl.close();
});
