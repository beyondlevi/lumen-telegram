// Stand-in for `htmlparser2`, which GramJS needs only for the HTML parse mode.
// The app sends plain text (parse mode off), so using it is a bug.
export class Parser {
  constructor() {
    throw new Error('HTML parse mode is not available in lumen-telegram');
  }
}
export default {Parser};
