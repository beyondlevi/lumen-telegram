// Browser stand-in for Node's `util`: GramJS only reads util.inspect.custom.
export const inspect = {custom: Symbol.for('nodejs.util.inspect.custom')};
export default {inspect};
