// Browser stand-in for Node's `os`, used by GramJS only for the device name.
const os = {type: () => 'Lumen', release: () => '1.0', hostname: () => 'localhost', platform: () => 'browser', EOL: '\n'};
export default os;
export const {type, release, hostname, platform, EOL} = os;
