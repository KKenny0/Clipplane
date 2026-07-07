export function encodeNativeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

export function createNativeMessageParser(onMessage) {
  let buffer = Buffer.alloc(0);

  return function parseChunk(chunk) {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (buffer.length < length + 4) {
        break;
      }

      const body = buffer.subarray(4, 4 + length);
      buffer = buffer.subarray(4 + length);
      onMessage(JSON.parse(body.toString("utf8")));
    }
  };
}

export function writeNativeMessage(stream, message) {
  stream.write(encodeNativeMessage(message));
}
