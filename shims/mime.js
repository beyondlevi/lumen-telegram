// Small stand-in for the `mime` package (GramJS names downloaded files and
// guesses upload types with it). The app downloads photos and voice notes and
// never uploads, so a few types are enough and the full type database stays out.
const TYPES = {jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', ogg: 'audio/ogg', oga: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4', pdf: 'application/pdf'};
const EXTENSIONS = Object.fromEntries(Object.entries(TYPES).reverse().map(([extension, type]) => [type, extension]));
const mime = {
  getType: path => TYPES[String(path).split('.').pop()?.toLowerCase() ?? ''] ?? null,
  getExtension: type => EXTENSIONS[String(type).split(';')[0].trim().toLowerCase()] ?? null,
};
export default mime;
export const {getType, getExtension} = mime;
