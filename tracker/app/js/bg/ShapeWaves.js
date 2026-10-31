// ShapeWaves: 1:1 port of React Bits ShapeWaves (github.com/DavidHDev/react-bits, MIT). Source unchanged; bundled by esbuild with a tiny React stand-in (react-shim.js). default export (el, props) → { stop }.
import {
  h,
  mount,
  useEffect,
  useRef,
  useState
} from "./chunk-M5IL2LNY.js";

// node_modules/@vgpu/core/dist/errors.js
var VGPUError = class extends Error {
  code;
  severity;
  fix;
  where;
  cause;
  detail;
  constructor(data) {
    super(data.message, { cause: data.cause });
    this.name = "VGPUError";
    this.code = data.code;
    this.severity = data.severity ?? "error";
    this.fix = data.fix;
    this.where = data.where;
    this.cause = data.cause;
    this.detail = data.detail;
  }
};
var ValidationError = class extends VGPUError {
  constructor(data) {
    super({ ...data, severity: "error" });
    this.name = "ValidationError";
  }
};
function unsupportedFeaturesError(missing) {
  return new VGPUError({
    code: "VGPU-FEATURE-UNSUPPORTED",
    message: `Adapter does not support requested feature(s): ${missing.map((name) => `"${name}"`).join(", ")}.`,
    fix: "Remove the unsupported name(s) from init({ requiredFeatures: [...] }) or run on an adapter that supports them; gate optional code paths on device.features after init.",
    where: "init"
  });
}
function validateRequiredFeatures(supported, required2) {
  if (!supported)
    return;
  const missing = (required2 ?? []).filter((feature) => !supported.has(feature));
  if (missing.length)
    throw unsupportedFeaturesError(missing);
}

// node_modules/@vgpu/core/dist/gpu-constants.js
var fallbackUsage = {
  map_read: 1,
  map_write: 2,
  copy_src: 4,
  copy_dst: 8,
  index: 16,
  vertex: 32,
  uniform: 64,
  storage: 128,
  indirect: 256,
  query_resolve: 512
};
function bufferUsageFlags(usages) {
  const constants = globalThis.GPUBufferUsage;
  return usages.reduce((flags, usage) => flags | usageFlag(usage, constants), 0);
}
function usageFlag(usage, constants) {
  const key = usage.toUpperCase();
  return constants?.[key] ?? fallbackUsage[usage];
}
function mapReadMode() {
  return globalThis.GPUMapMode?.READ ?? 1;
}
var fallbackTextureUsage = {
  copy_src: 1,
  copy_dst: 2,
  texture_binding: 4,
  storage_binding: 8,
  render_attachment: 16
};
function textureUsageFlags(usages) {
  const constants = globalThis.GPUTextureUsage;
  return usages.reduce((flags, usage) => flags | textureUsageFlag(usage, constants), 0);
}
function textureUsageFlag(usage, constants) {
  const key = usage.toUpperCase();
  return constants?.[key] ?? fallbackTextureUsage[usage];
}

// node_modules/@vgpu/core/dist/mock-gpu-storage.js
function isMockGPUBuffer(buffer) {
  return "__vgpuMockBytes" in buffer;
}
function isMockGPUTexture(texture) {
  return "__vgpuMockBytes" in texture;
}

// node_modules/@vgpu/core/dist/resource-lifecycle.js
var nextResourceId = 1;
function createResourceIdentity(kind) {
  return Object.freeze({ kind, id: nextResourceId++ });
}
var DestroySignal = class {
  callbacks = /* @__PURE__ */ new Set();
  destroyed = false;
  onDestroy(resource, cb) {
    if (this.destroyed) {
      cb(resource);
      return () => void 0;
    }
    this.callbacks.add(cb);
    return () => {
      this.callbacks.delete(cb);
    };
  }
  emit(resource) {
    if (this.destroyed)
      return false;
    this.destroyed = true;
    const callbacks = [...this.callbacks];
    this.callbacks.clear();
    const errors = [];
    for (const cb of callbacks) {
      try {
        cb(resource);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw errors[0];
    return true;
  }
};

// node_modules/@vgpu/core/dist/buffer.js
var Buffer = class {
  device;
  gpu;
  options;
  ownership;
  destroySignal = new DestroySignal();
  identity = createResourceIdentity("buffer");
  destroyed = false;
  constructor(device, gpu, options, ownership = "owned") {
    this.device = device;
    this.gpu = gpu;
    this.options = options;
    this.ownership = ownership;
    Object.defineProperty(this, "assertUsable", { value: (where, device2) => this.#assertUsable(where, device2) });
  }
  get resourceIdentity() {
    return this.identity;
  }
  onDestroy(cb) {
    return this.destroySignal.onDestroy(this, cb);
  }
  #assertUsable(where = "Buffer", device) {
    if (device && device.gpu !== this.device.gpu)
      throw new ValidationError({ code: "VGPU-BUFFER-DEVICE-MISMATCH", message: "Buffer belongs to a different GPU device.", where });
    if (this.destroyed) {
      throw new ValidationError({
        code: "VGPU-BUFFER-DISPOSED",
        message: "Buffer is destroyed.",
        where,
        fix: "Wrap or create a live GPUBuffer before using it."
      });
    }
    this.device.assertUsable(where);
  }
  write(data, offset = 0) {
    this.#assertUsable("Buffer.write");
    if (this.ownership === "external") {
      this.validateExternalOperation("write", offset, data.byteLength, "copy_dst");
    }
    try {
      this.device.queue.writeBuffer(this.gpu, offset, data);
    } catch (cause) {
      if (this.ownership !== "external")
        throw cause;
      throw externalBufferValidation("Buffer.write", "The external GPUBuffer rejected the write operation.", cause);
    }
  }
  async read(byteLength, offset = 0) {
    this.#assertUsable("Buffer.read");
    if (this.ownership === "external")
      this.validateExternalOperation("read", offset, byteLength, "copy_src");
    try {
      const result = await this.device.readback.read(this.gpu, byteLength, offset);
      this.#assertUsable("Buffer.read");
      return result;
    } catch (cause) {
      if (cause instanceof ValidationError || this.ownership !== "external")
        throw cause;
      throw externalBufferValidation("Buffer.read", "The external GPUBuffer rejected the read operation.", cause);
    }
  }
  destroy() {
    if (this.destroyed)
      return;
    this.destroyed = true;
    this.destroySignal.emit(this);
    if (this.ownership === "owned" && !isMockGPUBuffer(this.gpu))
      this.gpu.destroy();
  }
  dispose() {
    this.destroy();
  }
  validateExternalOperation(operation, offset, byteLength, requiredUsage) {
    const validRange = Number.isSafeInteger(offset) && offset >= 0 && offset % 4 === 0 && Number.isSafeInteger(byteLength) && byteLength >= 0 && byteLength % 4 === 0 && offset <= this.options.size && byteLength <= this.options.size - offset;
    if (!validRange) {
      throw externalBufferValidation(`Buffer.${operation}`, "External buffer offsets and lengths must be non-negative, 4-byte aligned, and within the buffer size.");
    }
    if ((this.gpu.usage & bufferUsageFlags([requiredUsage])) === 0) {
      throw externalBufferValidation(`Buffer.${operation}`, `External buffer is missing ${requiredUsage.toUpperCase()} usage.`);
    }
  }
};
function externalBufferValidation(where, message, cause) {
  return new ValidationError({
    code: "VGPU-EXTERNAL-BUFFER-VALIDATION",
    message,
    where,
    cause,
    fix: "Use a buffer with the required usage flags and an aligned in-range operation."
  });
}

// node_modules/@vgpu/wgsl/dist/compile.js
function compile(wgsl) {
  if (hasTopLevelImport(wgsl))
    throw runtimeImportError();
  const sourceMap = { version: 1, mappings: [] };
  const ast = {
    version: 1,
    modules: [{ path: "<runtime>", text: wgsl }],
    diagnostics: [],
    sourceMap,
    cacheKey: cacheKey(wgsl)
  };
  return {
    kind: "wgsl",
    wgsl,
    source: { text: wgsl, path: "<runtime>", imports: [] },
    ast,
    sourceMap,
    diagnostics: [],
    cacheKey: ast.cacheKey,
    entryPoints: entryPoints(wgsl),
    stats: { lines: wgsl.split(/\r?\n/).length, bytes: new TextEncoder().encode(wgsl).byteLength, bindGroups: 0 }
  };
}
function cacheKey(wgsl) {
  let hash = 2166136261;
  for (let i = 0; i < wgsl.length; i++)
    hash = Math.imul(hash ^ wgsl.charCodeAt(i), 16777619);
  return { default: `vgpu-wgsl-1:${(hash >>> 0).toString(16).padStart(8, "0")}` };
}
function entryPoints(wgsl) {
  const names = [];
  const read = tokenReader(wgsl);
  for (let token = read(); token !== void 0; token = read()) {
    let hasStage = false;
    while (token === "@") {
      if (/^(vertex|fragment|compute)$/.test(read()))
        hasStage = true;
      token = read();
      if (token === "(") {
        if (!skipParentheses(read))
          return names;
        token = read();
      }
    }
    if (token === "fn") {
      const name = read();
      token = read();
      if (hasStage && token === "(" && name && IDENTIFIER.test(name))
        names.push(name);
    }
    skipDeclaration(read, token);
  }
  return names;
}
var IDENTIFIER = /[_\p{XID_Start}]\p{XIDC}*/uy;
function tokenReader(source) {
  let index = 0;
  return () => {
    while (index < source.length) {
      const start = index;
      if (/\p{Pat_WS}/u.test(source[start])) {
        index++;
        continue;
      }
      if (source.startsWith("//", start)) {
        while (index < source.length && !/[\n-\r\u0085\u2028\u2029]/.test(source[index]))
          index++;
        continue;
      }
      if (source.startsWith("/*", start)) {
        index += 2;
        let depth = 1;
        while (index < source.length && depth > 0) {
          if (source.startsWith("/*", index)) {
            depth++;
            index += 2;
          } else if (source.startsWith("*/", index)) {
            depth--;
            index += 2;
          } else {
            index++;
          }
        }
        continue;
      }
      IDENTIFIER.lastIndex = start;
      const identifier = IDENTIFIER.exec(source);
      if (identifier) {
        index = IDENTIFIER.lastIndex;
        return identifier[0];
      }
      index++;
      return source[start];
    }
    return void 0;
  };
}
function skipParentheses(read) {
  let depth = 1;
  for (let token = read(); token !== void 0; token = read()) {
    if (token === "(")
      depth++;
    else if (token === ")" && --depth === 0)
      return true;
  }
  return false;
}
function skipDeclaration(read, first) {
  let braces = 0;
  for (let token = first; token !== void 0; token = read()) {
    if (token === "{")
      braces++;
    else if (token === "}" && braces > 0 && --braces === 0)
      return;
    else if (token === ";" && braces === 0)
      return;
  }
}
function hasTopLevelImport(wgsl) {
  const stripped = wgsl.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").trimStart();
  return stripped.startsWith("import ") || stripped.startsWith("import{");
}
function runtimeImportError() {
  const error = new Error("Runtime WGSL strings cannot contain import statements. Use a build-time loader or @vgpu/wgsl/runtime.");
  error.name = "VGPUWGSLRuntimeImportError";
  error.code = "VGPU-WGSL-RUNTIME-IMPORT";
  error.severity = "error";
  error.source = "wgsl";
  return error;
}

// node_modules/@vgpu/core/dist/texture-read-selection.js
function textureMipExtent(texture, mipLevel) {
  const scale = 2 ** mipLevel;
  return [
    Math.max(1, Math.floor(texture.width / scale)),
    Math.max(1, Math.floor(texture.height / scale)),
    texture.dimension === "3d" ? Math.max(1, Math.floor(texture.depthOrArrayLayers / scale)) : texture.depthOrArrayLayers
  ];
}
function textureReadSelection(texture, options, where) {
  const fail2 = (message) => {
    throw new ValidationError({
      code: "VGPU-CORE-TEXTURE-READ-INVALID",
      where,
      message,
      fix: 'Select an allocated mip and an in-bounds region on a single-sample texture with usage "copy_src".'
    });
  };
  if (!options || !Number.isSafeInteger(options.mipLevel) || options.mipLevel < 0 || options.mipLevel >= texture.mipLevelCount)
    fail2("mipLevel must select an allocated mip using a nonnegative safe integer.");
  if (texture.sampleCount !== 1)
    fail2("Texture readback requires sampleCount 1; resolve multisampled textures explicitly before reading.");
  if (!(texture.usage & textureUsageFlags(["copy_src"])))
    fail2('Texture readback requires explicit "copy_src" usage.');
  const extent = textureMipExtent(texture, options.mipLevel);
  const origin = options.region === "all" ? [0, 0, 0] : options.region?.origin;
  const size = options.region === "all" ? extent : options.region?.size;
  if (!Array.isArray(origin) || origin.length !== 3 || !Array.isArray(size) || size.length !== 3)
    fail2('region must be "all" or contain origin and size triples.');
  for (let i = 0; i < 3; i++) {
    const start = origin[i];
    const length = size[i];
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(length) || length <= 0 || start > extent[i] || length > extent[i] - start)
      fail2(`Read region axis ${i} is outside mip ${options.mipLevel} extent [${extent}].`);
  }
  return { mipLevel: options.mipLevel, origin: [...origin], size: [...size], extent };
}
function validateReadAllocation(byteLength, maxBufferSize, where) {
  const limit = Math.min(maxBufferSize ?? 4294967295, 4294967295);
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > limit) {
    throw new ValidationError({
      code: "VGPU-CORE-TEXTURE-READ-INVALID",
      where,
      message: `Readback allocation of ${byteLength} bytes exceeds the supported limit (${limit}).`,
      fix: "Read a smaller region or a higher mip level."
    });
  }
}

// node_modules/@vgpu/core/dist/readback.js
var stagingUsage = bufferUsageFlags(["copy_dst", "map_read"]);
var Readback = class {
  device;
  constructor(device) {
    this.device = device;
  }
  async read(source, byteLength, offset) {
    if (isMockGPUBuffer(source)) {
      return source.__vgpuMockBytes.slice(offset, offset + byteLength).buffer;
    }
    const staging = this.device.createBuffer({
      size: byteLength,
      usage: stagingUsage
    });
    try {
      const encoder = this.device.createCommandEncoder();
      encoder.copyBufferToBuffer(source, offset, staging, 0, byteLength);
      this.device.queue.submit([encoder.finish()]);
      await staging.mapAsync(mapReadMode());
      const copy = staging.getMappedRange().slice(0);
      unmapQuietly(staging);
      return copy;
    } finally {
      destroyQuietly(staging);
    }
  }
  async readTexture(texture, options) {
    const formatInfo = textureReadbackFormat(texture.format, "Readback.readTexture");
    const selection = textureReadSelection(texture, options, "Readback.readTexture");
    const [width, height, depth] = selection.size;
    const bytesPerPixel = formatInfo.bytesPerPixel;
    const bytesPerRow = align(width * bytesPerPixel, 256);
    const byteLength = bytesPerRow * height * depth;
    validateReadAllocation(byteLength, this.device.limits?.maxBufferSize, "Readback.readTexture");
    if (isMockGPUTexture(texture)) {
      const stored = texture.__vgpuMockMips?.[selection.mipLevel] ?? (selection.mipLevel === 0 ? texture.__vgpuMockBytes : void 0);
      if (!stored)
        throw new Error("Mock texture has no storage for the selected mip.");
      return readMockTextureBytes(stored, selection, formatInfo);
    }
    const staging = this.device.createBuffer({ size: byteLength, usage: stagingUsage });
    let pixels;
    try {
      const encoder = this.device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture, mipLevel: selection.mipLevel, origin: selection.origin }, { buffer: staging, bytesPerRow, rowsPerImage: height }, { width, height, depthOrArrayLayers: depth });
      this.device.queue.submit([encoder.finish()]);
      await staging.mapAsync(mapReadMode());
      const padded = new Uint8Array(staging.getMappedRange());
      pixels = new Uint8Array(width * height * depth * bytesPerPixel);
      for (let y = 0; y < height * depth; y++) {
        const src = y * bytesPerRow;
        const dst = y * width * bytesPerPixel;
        pixels.set(padded.subarray(src, src + width * bytesPerPixel), dst);
      }
      unmapQuietly(staging);
    } finally {
      destroyQuietly(staging);
    }
    if (formatInfo.swizzle === "bgra-to-rgba")
      swizzleBgraToRgba(pixels);
    return pixels;
  }
  destroy() {
  }
};
function unmapQuietly(buffer) {
  try {
    buffer.unmap();
  } catch {
  }
}
function destroyQuietly(buffer) {
  try {
    buffer.destroy();
  } catch {
  }
}
function align(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}
var readbackFormats = {
  "r8unorm": { bytesPerPixel: 1, components: 1, componentType: "unorm8" },
  "rg8unorm": { bytesPerPixel: 2, components: 2, componentType: "unorm8" },
  "rgba8unorm": { bytesPerPixel: 4, components: 4, componentType: "unorm8" },
  "rgba8unorm-srgb": { bytesPerPixel: 4, components: 4, componentType: "unorm8" },
  "bgra8unorm": { bytesPerPixel: 4, components: 4, componentType: "unorm8", swizzle: "bgra-to-rgba" },
  "bgra8unorm-srgb": { bytesPerPixel: 4, components: 4, componentType: "unorm8", swizzle: "bgra-to-rgba" },
  "r16float": { bytesPerPixel: 2, components: 1, componentType: "float16" },
  "rg16float": { bytesPerPixel: 4, components: 2, componentType: "float16" },
  "rgba16float": { bytesPerPixel: 8, components: 4, componentType: "float16" },
  "r32float": { bytesPerPixel: 4, components: 1, componentType: "float32" },
  "rg32float": { bytesPerPixel: 8, components: 2, componentType: "float32" },
  "rgba32float": { bytesPerPixel: 16, components: 4, componentType: "float32" }
};
function textureReadbackFormat(format, where) {
  const info = readbackFormats[format];
  if (info)
    return info;
  throw new ValidationError({
    code: "VGPU-CORE-UNSUPPORTED-FORMAT",
    message: `Texture.read does not support format ${format}. Supported formats: ${Object.keys(readbackFormats).join(", ")}.`,
    where
  });
}
function decodeTextureFloats(bytes, format, where = "Texture.readFloats") {
  const info = textureReadbackFormat(format, where);
  const bytesPerComponent = info.bytesPerPixel / info.components;
  const count = Math.floor(bytes.byteLength / bytesPerComponent);
  const floats = new Float32Array(count);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < count; i++) {
    if (info.componentType === "unorm8")
      floats[i] = view.getUint8(i) / 255;
    else if (info.componentType === "float16")
      floats[i] = halfToFloat(view.getUint16(i * 2, true));
    else
      floats[i] = view.getFloat32(i * 4, true);
  }
  return floats;
}
function halfToFloat(bits) {
  const sign = bits & 32768 ? -1 : 1;
  const exponent = bits >> 10 & 31;
  const mantissa = bits & 1023;
  if (exponent === 0)
    return sign * mantissa * 2 ** -24;
  if (exponent === 31)
    return mantissa === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN;
  return sign * (mantissa + 1024) * 2 ** (exponent - 25);
}
function readMockTextureBytes(stored, selection, info) {
  const { size: [width, height, depth], origin: [x, y, z], extent } = selection;
  const rowBytes = width * info.bytesPerPixel;
  const pixels = new Uint8Array(rowBytes * height * depth);
  for (let layer = 0; layer < depth; layer++)
    for (let row = 0; row < height; row++) {
      const src = (((z + layer) * extent[1] + y + row) * extent[0] + x) * info.bytesPerPixel;
      pixels.set(stored.subarray(src, src + rowBytes), (layer * height + row) * rowBytes);
    }
  if (info.swizzle === "bgra-to-rgba")
    swizzleBgraToRgba(pixels);
  return pixels;
}
function swizzleBgraToRgba(pixels) {
  for (let i = 0; i < pixels.length; i += 4) {
    const b = pixels[i];
    pixels[i] = pixels[i + 2];
    pixels[i + 2] = b;
  }
}

// node_modules/@vgpu/core/dist/mock-gpu.js
function mockBufferDescriptor(size) {
  return { size, usage: bufferUsageFlags(["copy_src", "copy_dst"]) };
}

// node_modules/@vgpu/core/dist/queue.js
var Queue = class {
  gpu;
  guard;
  constructor(gpu, guard = () => void 0) {
    this.gpu = gpu;
    this.guard = guard;
  }
  writeBuffer(buffer, offset, data) {
    this.guard("Queue.writeBuffer");
    this.gpu.writeBuffer(buffer, offset, data);
  }
  async flush() {
    this.guard("Queue.flush");
    await this.gpu.onSubmittedWorkDone?.();
    this.guard("Queue.flush");
  }
};

// node_modules/@vgpu/core/dist/shader.js
var Shader = class {
  gpu;
  resolved;
  constructor(gpu, resolved) {
    this.gpu = gpu;
    this.resolved = resolved;
  }
  dispose() {
  }
  get kind() {
    return this.resolved.kind;
  }
  get source() {
    return this.resolved.source;
  }
  get code() {
    return this.resolved.wgsl;
  }
  get entryPoints() {
    return this.resolved.entryPoints;
  }
  get stats() {
    return this.resolved.stats;
  }
};

// node_modules/@vgpu/core/dist/texture-options.js
var USAGES = /* @__PURE__ */ new Set(["copy_src", "copy_dst", "texture_binding", "storage_binding", "render_attachment"]);
var STORAGE_FORMATS = /* @__PURE__ */ new Set([
  "rgba8unorm",
  "rgba8snorm",
  "rgba8uint",
  "rgba8sint",
  "rgba16float",
  "rgba16uint",
  "rgba16sint",
  "rgba32float",
  "rgba32uint",
  "rgba32sint",
  "r32float",
  "r32uint",
  "r32sint",
  "rg32float",
  "rg32uint",
  "rg32sint"
]);
var TIER1_STORAGE_FORMATS = /* @__PURE__ */ new Set([
  "r8unorm",
  "r8snorm",
  "r8uint",
  "r8sint",
  "rg8unorm",
  "rg8snorm",
  "rg8uint",
  "rg8sint",
  "r16uint",
  "r16sint",
  "r16float",
  "rg16uint",
  "rg16sint",
  "rg16float",
  "rgb10a2uint",
  "rgb10a2unorm",
  "rg11b10ufloat",
  "r16unorm",
  "r16snorm",
  "rg16unorm",
  "rg16snorm",
  "rgba16unorm",
  "rgba16snorm"
]);
function snapshotTextureOptions(opts) {
  return Object.freeze({
    ...opts,
    size: Object.freeze([...opts.size]),
    usage: Object.freeze([...opts.usage]),
    ...opts.viewFormats === void 0 ? {} : { viewFormats: Object.freeze([...opts.viewFormats]) }
  });
}
function textureExtent(opts) {
  return [opts.size[0], opts.kind === "1d" ? 1 : opts.size[1], opts.kind === "2d-array" ? opts.layers : opts.kind === "3d" ? opts.size[2] : 1];
}
function validateTextureOptions(opts, device) {
  const fail2 = (code, message, fix) => {
    throw new ValidationError({ code, message, fix, where: "Device.createTexture" });
  };
  if (!opts || !["1d", "2d", "3d", "2d-array"].includes(opts.kind)) {
    fail2("VGPU-TEXTURE-KIND-REQUIRED", "Texture kind must be explicit.", 'Pass kind: "1d", "2d", "3d", or "2d-array".');
  }
  if ("dimension" in opts)
    fail2("VGPU-TEXTURE-KIND-REQUIRED", "Texture dimension has been replaced by kind.", 'Use kind and, for "2d-array", a separate layers count.');
  const axes = opts.kind === "1d" ? 1 : opts.kind === "3d" ? 3 : 2;
  if (!Array.isArray(opts.size) || opts.size.length !== axes || !Array.from(opts.size).every(positiveInteger)) {
    fail2("VGPU-TEXTURE-SIZE-REQUIRED", `Texture ${opts.kind} needs ${axes} positive integer spatial dimensions.`, "Pass size with exactly the spatial dimensions of kind; put array layers in layers.");
  }
  if (opts.kind === "2d-array" ? !positiveInteger(opts.layers) : opts.layers !== void 0) {
    fail2("VGPU-TEXTURE-LAYERS-INVALID", "Only 2d-array textures take a positive integer layers count.", 'Use kind: "2d-array", size: [width, height], layers: count.');
  }
  if (!Array.isArray(opts.usage) || opts.usage.length === 0 || !Array.from(opts.usage).every((usage) => USAGES.has(usage))) {
    fail2("VGPU-TEXTURE-USAGE-REQUIRED", "Texture usage must be a nonempty list of known capabilities.", 'Pass explicit usage, such as ["texture_binding", "copy_dst"]. No capabilities are added automatically.');
  }
  if (typeof opts.format !== "string" || !opts.format)
    fail2("VGPU-TEXTURE-FORMAT-REQUIRED", "Texture format is required.", 'Pass an explicit GPUTextureFormat, such as "rgba16float".');
  const levels = opts.mipLevelCount ?? 1;
  const maxLevels = opts.kind === "1d" ? 1 : Math.floor(Math.log2(Math.max(...opts.size))) + 1;
  if (!positiveInteger(levels) || levels > maxLevels) {
    fail2("VGPU-TEXTURE-MIPS-INVALID", `mipLevelCount must be between 1 and ${maxLevels}.`, "Omit mipLevelCount for the base level, or request a valid allocation count. Contents are not generated automatically.");
  }
  const samples = opts.sampleCount ?? 1;
  if (samples !== 1 && samples !== 4)
    fail2("VGPU-TEXTURE-SAMPLES-INVALID", "sampleCount must be 1 or 4.", "Omit sampleCount for single-sample storage.");
  if (samples === 4 && (opts.kind !== "2d" || levels !== 1 || !opts.usage.includes("render_attachment") || opts.usage.includes("storage_binding"))) {
    fail2("VGPU-TEXTURE-SAMPLES-INVALID", "MSAA requires a 2d render attachment with one mip and no storage_binding.", "Use a single-sample texture for storage, arrays or volumes; resolve MSAA into a separate texture.");
  }
  if (opts.kind === "1d" && (opts.usage.includes("render_attachment") || /^(depth|stencil|bc|etc2|eac|astc)/.test(opts.format))) {
    fail2("VGPU-TEXTURE-KIND-INVALID", "1d textures cannot be render attachments or use depth/stencil/compressed formats.", "Use a 2d texture or a plain color format with non-attachment usage.");
  }
  const extent = textureExtent(opts);
  const limitName = opts.kind === "1d" ? "maxTextureDimension1D" : opts.kind === "3d" ? "maxTextureDimension3D" : "maxTextureDimension2D";
  const limit = device.limits?.[limitName];
  if (limit !== void 0 && opts.size.some((size) => size > limit) || opts.kind === "2d-array" && device.limits?.maxTextureArrayLayers !== void 0 && extent[2] > device.limits.maxTextureArrayLayers) {
    fail2("VGPU-TEXTURE-LIMIT", "Texture dimensions or layers exceed enabled device limits.", "Reduce the allocation or request sufficient limits when initializing the device.");
  }
  const hasFeature = (name) => device.features?.has(name) ?? false;
  if (opts.usage.includes("storage_binding") && !STORAGE_FORMATS.has(opts.format) && !(opts.format === "bgra8unorm" && hasFeature("bgra8unorm-storage")) && !(TIER1_STORAGE_FORMATS.has(opts.format) && hasFeature("texture-formats-tier1"))) {
    fail2("VGPU-TEXTURE-STORAGE-FORMAT", `Format ${opts.format} does not support storage_binding with the enabled features.`, "Choose a supported storage format, enable the required format feature, or explicitly omit storage_binding from usage.");
  }
  if (opts.viewFormats !== void 0 && (!Array.isArray(opts.viewFormats) || !Array.from(opts.viewFormats).every((format) => typeof format === "string" && format.replace(/-srgb$/, "") === opts.format.replace(/-srgb$/, "")))) {
    fail2("VGPU-TEXTURE-VIEW-FORMAT", "viewFormats must list formats compatible with the texture format.", "Only the same format or its compatible linear/sRGB counterpart is allowed; native device restrictions also apply.");
  }
}
function positiveInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

// node_modules/@vgpu/core/dist/texture.js
var textureBrand = /* @__PURE__ */ Symbol.for("vgpu/Texture");
var Texture = class {
  device;
  ownership;
  [textureBrand] = true;
  destroySignal = new DestroySignal();
  identity = createResourceIdentity("texture");
  currentGpu;
  currentOptions;
  defaultView = null;
  destroyed = false;
  constructor(device, gpu, options, ownership = "owned") {
    this.device = device;
    this.ownership = ownership;
    this.currentGpu = gpu;
    this.currentOptions = snapshotTextureOptions(options);
  }
  get gpu() {
    return this.currentGpu;
  }
  get options() {
    return this.currentOptions;
  }
  get size() {
    return this.options.size;
  }
  get format() {
    return this.options.format;
  }
  get usage() {
    return this.options.usage;
  }
  get mipLevelCount() {
    return this.options.mipLevelCount ?? 1;
  }
  get sampleCount() {
    return this.options.sampleCount ?? 1;
  }
  get kind() {
    return this.options.kind;
  }
  get layers() {
    return this.options.kind === "2d-array" ? this.options.layers : 1;
  }
  /** Native dimension retained for low-level interop; kind distinguishes arrays. */
  get dimension() {
    return this.options.kind === "2d-array" ? "2d" : this.options.kind;
  }
  get viewFormats() {
    return this.options.viewFormats ?? [];
  }
  get label() {
    return this.options.label;
  }
  get resourceIdentity() {
    return this.identity;
  }
  onDestroy(cb) {
    return this.destroySignal.onDestroy(this, cb);
  }
  get view() {
    this.assertAlive();
    this.defaultView ??= this.createView();
    return this.defaultView;
  }
  createView(desc) {
    this.assertAlive("Texture.createView");
    return this.gpu.createView(this.kind === "2d-array" ? { ...desc, dimension: desc?.dimension ?? "2d-array" } : desc);
  }
  /**
   * Raw, unpadded texel bytes in this texture's own format (row stride padding removed).
   * Tightly packed X, then Y, then Z across the selected mip region; `bgra*` is swizzled to RGBA.
   * Use `readFloats()` for float formats to get decoded component values.
   */
  async read(options) {
    this.assertAlive("Texture.read");
    const result = await this.device.readback.readTexture(this.gpu, options);
    this.assertAlive("Texture.read");
    return result;
  }
  /**
   * Selected texel components decoded to f32, tightly packed in X/Y/Z order.
   * `float16`/`float32` formats keep their HDR values (no clamping); `unorm8` formats are
   * normalized to `[0, 1]` without srgb gamma conversion.
   */
  async readFloats(options) {
    this.assertAlive("Texture.readFloats");
    const info = textureReadbackFormat(this.options.format, "Texture.readFloats");
    const { size } = textureReadSelection(this.gpu, options, "Texture.readFloats");
    validateReadAllocation(size[0] * size[1] * size[2] * info.components * 4, this.device.gpu.limits?.maxBufferSize, "Texture.readFloats");
    return decodeTextureFloats(await this.read(options), this.options.format);
  }
  destroy() {
    if (this.destroyed)
      return;
    this.destroyed = true;
    this.defaultView = null;
    try {
      this.destroySignal.emit(this);
    } finally {
      if (this.ownership !== "external" && !isMockGPUTexture(this.gpu))
        this.gpu.destroy();
    }
  }
  dispose() {
    this.destroy();
  }
  assertAlive(where = "Texture") {
    if (this.destroyed)
      throw new ValidationError({ code: "VGPU-CORE-TEXTURE-DESTROYED", message: "Texture is destroyed", where });
    this.device.assertUsable?.(where);
  }
};
function toGPUTextureDescriptor(opts) {
  const [width, height, depthOrArrayLayers] = textureExtent(opts);
  const desc = {
    label: opts.label,
    size: { width, height, depthOrArrayLayers },
    dimension: opts.kind === "2d-array" ? "2d" : opts.kind,
    format: opts.format,
    usage: textureUsageFlags(opts.usage)
  };
  if (opts.mipLevelCount !== void 0)
    desc.mipLevelCount = opts.mipLevelCount;
  if (opts.sampleCount !== void 0)
    desc.sampleCount = opts.sampleCount;
  if (opts.viewFormats !== void 0)
    desc.viewFormats = [...opts.viewFormats];
  if (opts.kind === "2d-array")
    desc.textureBindingViewDimension = "2d-array";
  return desc;
}

// node_modules/@vgpu/core/dist/device.js
var Device = class {
  gpu;
  adapterInfo;
  queue;
  /** @internal — use Buffer.read() and Texture.read() instead */
  readback;
  isCompatibilityMode;
  scopes = [];
  ownership;
  state = "alive";
  lossInfo;
  observeLoss = true;
  lossObservers = /* @__PURE__ */ new Set();
  constructor(gpu, adapterInfo = null, ownershipOrOptions = "owned", options = {}) {
    this.gpu = gpu;
    this.adapterInfo = adapterInfo;
    Object.defineProperty(this, "assertUsable", { value: (where) => this.#assertUsable(where) });
    Object.defineProperty(this, "onObservedLoss", {
      value: (observer) => {
        if (this.state === "lost" && this.lossInfo) {
          observer(this.lossInfo);
          return () => void 0;
        }
        if (!this.observeLoss || this.state !== "alive")
          return () => void 0;
        this.lossObservers.add(observer);
        return () => {
          this.lossObservers.delete(observer);
        };
      }
    });
    this.ownership = typeof ownershipOrOptions === "string" ? ownershipOrOptions : "owned";
    const opts = typeof ownershipOrOptions === "string" ? options : ownershipOrOptions;
    this.isCompatibilityMode = opts.isCompatibilityMode ?? false;
    this.queue = new Queue(gpu.queue, (where) => this.#assertUsable(where));
    this.readback = new Readback(gpu);
    const lost = gpu.lost;
    if (lost && typeof lost.then === "function") {
      void Promise.resolve(lost).then((info) => {
        if (!this.observeLoss || this.state !== "alive")
          return;
        this.lossInfo = info;
        this.state = "lost";
        const observers = [...this.lossObservers];
        this.lossObservers.clear();
        for (const observer of observers) {
          try {
            observer(info);
          } catch {
          }
        }
      }, () => void 0);
    }
  }
  get limits() {
    this.#assertUsable("Device.limits");
    return this.gpu.limits;
  }
  get features() {
    this.#assertUsable("Device.features");
    return this.gpu.features;
  }
  createShader(input) {
    this.#assertUsable("Device.createShader");
    const resolved = typeof input === "string" ? compile(input) : input;
    return new Shader(this.gpu.createShaderModule({ code: resolved.wgsl }), resolved);
  }
  createTexture(opts) {
    this.#assertUsable("Device.createTexture");
    validateTextureOptions(opts, this.gpu);
    const snapshot = snapshotTextureOptions(opts);
    return new Texture(this, this.gpu.createTexture(toGPUTextureDescriptor(snapshot)), snapshot);
  }
  createBuffer(opts) {
    this.#assertUsable("Device.createBuffer");
    const error = validateBufferOptions(opts);
    if (error)
      this.captureError(error);
    const desc = error ? mockBufferDescriptor(Math.max(4, opts.size || 4)) : toGPUBufferDescriptor(opts);
    return new Buffer(this, this.gpu.createBuffer(desc), opts);
  }
  /** Wraps a caller-owned GPUBuffer without taking ownership of its native lifetime. */
  wrapBuffer(buffer) {
    this.#assertUsable("Device.wrapBuffer");
    if (!isExternalBufferShape(buffer)) {
      throw new ValidationError({
        code: "VGPU-EXTERNAL-BUFFER-INVALID",
        message: "Device.wrapBuffer requires a GPUBuffer with finite size and usage properties.",
        where: "Device.wrapBuffer",
        fix: "Pass a live GPUBuffer created for this GPUDevice."
      });
    }
    const options = {
      size: buffer.size,
      usage: bufferUsageNames(buffer.usage),
      ...buffer.label ? { label: buffer.label } : {}
    };
    return new Buffer(this, buffer, options, "external");
  }
  pushErrorScope(filter) {
    this.#assertUsable("Device.pushErrorScope");
    this.scopes.push([]);
    this.gpu.pushErrorScope?.(filter);
  }
  async popErrorScope() {
    this.#assertUsable("Device.popErrorScope");
    const scope = this.scopes.pop();
    const nativeError = await this.gpu.popErrorScope?.();
    this.#assertUsable("Device.popErrorScope");
    return scope?.[0] ?? nativeErrorToVGPUError(nativeError) ?? null;
  }
  #assertUsable(where) {
    if (this.state === "alive")
      return;
    if (this.state === "disposed") {
      throw new ValidationError({
        code: "VGPU-DEVICE-DISPOSED",
        message: "The GPU device wrapper has been disposed.",
        where,
        fix: "Create a new Gpu instance before performing more work."
      });
    }
    const reason = this.lossInfo?.reason;
    const nativeMessage = this.lossInfo?.message;
    throw new ValidationError({
      code: "VGPU-DEVICE-LOST",
      message: `The GPU device was lost${reason ? ` (${reason})` : ""}${nativeMessage ? `: ${nativeMessage}` : "."}`,
      where,
      cause: this.lossInfo,
      fix: "Create a new Gpu with init(), then recreate its resources and restart the loop."
    });
  }
  destroy() {
    if (this.state === "disposed")
      return;
    const wasLost = this.state === "lost";
    this.state = "disposed";
    this.observeLoss = false;
    this.lossObservers.clear();
    this.scopes.length = 0;
    this.readback.destroy();
    if (this.ownership === "owned" && !wasLost)
      this.gpu.destroy();
  }
  dispose() {
    this.destroy();
  }
  captureError(error) {
    const scope = this.scopes.at(-1);
    if (scope)
      scope.push(error);
    else
      throw error;
  }
};
function validateBufferOptions(opts) {
  if (!Number.isFinite(opts.size) || opts.size <= 0)
    return invalidUsage("Buffer size must be greater than zero.");
  if (opts.usage.length === 0)
    return invalidUsage("Buffer usage must not be empty.");
  return null;
}
function invalidUsage(message) {
  return new ValidationError({ code: "VGPU-CORE-INVALID-USAGE", message, where: "Device.createBuffer" });
}
function toGPUBufferDescriptor(opts) {
  return { label: opts.label, size: opts.size, usage: bufferUsageFlags(opts.usage) };
}
function nativeErrorToVGPUError(error) {
  if (!error)
    return null;
  return new ValidationError({ code: "VGPU-CORE-VALIDATION", message: error.message, where: "GPUDevice.popErrorScope", cause: error });
}
function isExternalBufferShape(value) {
  if (typeof value !== "object" && typeof value !== "function" || value === null)
    return false;
  const buffer = value;
  return Number.isSafeInteger(buffer.size) && (buffer.size ?? -1) >= 0 && Number.isSafeInteger(buffer.usage) && (buffer.usage ?? -1) >= 0 && typeof buffer.destroy === "function";
}
var bufferUsages = ["map_read", "map_write", "copy_src", "copy_dst", "index", "vertex", "uniform", "storage", "indirect", "query_resolve"];
function bufferUsageNames(flags) {
  return bufferUsages.filter((usage) => (flags & bufferUsageFlags([usage])) !== 0);
}

// node_modules/@vgpu/core/dist/bind-group-metadata.js
var layoutMetadata = /* @__PURE__ */ new WeakMap();
var bindGroupMetadata = /* @__PURE__ */ new WeakMap();
function attachBindGroupLayoutMetadata(layout, metadata) {
  layoutMetadata.set(layout, cloneLayoutMetadata(metadata));
  return layout;
}
function bindGroupLayoutMetadata(layout) {
  return layoutMetadata.get(layout);
}
function bindGroupMetadataFor(bindGroup) {
  return bindGroupMetadata.get(bindGroup);
}
function cloneLayoutMetadata(metadata) {
  return { entries: metadata.entries.map((entry) => ({ ...entry })) };
}

// node_modules/vgpu/dist/errors.js
var VGPUError2 = class extends VGPUError {
};
function surfaceNotBindableError(label, binding) {
  return new VGPUError2({
    code: "VGPU-SURFACE-NOT-BINDABLE",
    message: `Binding '${binding.name}' (@group(${binding.group}) @binding(${binding.binding})) in '${label}' cannot use a Surface as an input.`,
    where: `${label}.${binding.name}`,
    fix: "Render to an offscreen target and bind that target or its texture. Use Surface only as a render destination.",
    detail: { binding: binding.binding, bindingName: binding.name }
  });
}
function destroyedBindingError(label, binding, resourceName = "resource") {
  return new VGPUError2({
    code: "VGPU-R1-BINDING-DESTROYED",
    message: `Binding '${binding.name}' (@group(${binding.group}) @binding(${binding.binding})) in '${label}' refers to destroyed resource '${resourceName}'.`,
    where: `${label}.${binding.name}`,
    fix: `Create a live resource and call set({ ${binding.name}: replacement }). Direct attachment references do not follow target.resize(); bind the Target itself to follow replacements. Re-record bundles that captured the old resource.`,
    detail: { binding: binding.binding, bindingName: binding.name, resourceName }
  });
}
function storageStageLimitError(label, stage, entryPoint, count, limit, bindings) {
  const title = stage === "vertex" ? "Vertex" : "Fragment";
  const suffix = stage === "vertex" ? "VERTEX" : "FRAGMENT";
  const limitName = `maxStorageBuffersIn${title}Stage`;
  return new VGPUError2({
    code: `VGPU-LIMIT-STORAGE-${suffix}`,
    message: `${title} entry '${entryPoint}' in '${label}' uses ${count} storage buffer(s), but device limit ${limitName} is ${limit}.`,
    fix: stage === "vertex" ? `Request init({ requiredLimits: { ${limitName}: ${count} } }) if the adapter supports it, or move vertex data to geometry(gpu, ...) vertex streams.` : `Request init({ requiredLimits: { ${limitName}: ${count} } }) if the adapter supports it, or reduce fragment storage buffers.`,
    where: `${label}.pipelineLayout`,
    detail: { stage, entryPoint, count, limit, bindings: bindings.map(({ name, group, binding }) => ({ name, group, binding })) }
  });
}
function textureFilterabilityError(label, binding, format, resourceName, sampler2) {
  return new VGPUError2({
    code: "VGPU-SET-TEXTURE-FILTERABILITY",
    message: `${resourceName} (${format}) cannot satisfy filtering texture '${binding.name}' @group(${binding.group}) @binding(${binding.binding}).`,
    fix: "Use a filterable format; request float32-filterable for rgba32float when supported; or use textureLoad without a sampler.",
    where: `${label}.set`,
    detail: { format, group: binding.group, binding: binding.binding, bindingName: binding.name, resourceName, samplerName: sampler2?.name, samplerGroup: sampler2?.group, samplerBinding: sampler2?.binding }
  });
}
function neverSetError(drawLabel, binding) {
  const fix = missingBindingFix(drawLabel, binding);
  return new VGPUError2({
    code: "VGPU-R1-BINDING-NEVER-SET",
    message: `Unset \`${binding.name}\` @group(${binding.group}) @binding(${binding.binding}) in '${drawLabel}'. Fix: ${fix}; or ${drawLabel}.group(${binding.group}, bindGroup).`,
    where: `${drawLabel}.draw`
  });
}
function ownershipFlipError(name, previous) {
  const previousText = previous === "lib" ? "lib-owned by its first JS set()" : "user-owned by its first resource set()";
  const fix = previous === "lib" ? `Fix: pass a resource from the start: wave.set({ ${name}: new Uniform(gpu.device, { size: 4 }) }).` : `Fix: pass JS values from the first set(): wave.set({ ${name}: jsValue }).`;
  return new VGPUError2({
    code: "VGPU-R1-OWNERSHIP-FLIP",
    message: `\`${name}\` is ${previousText}; ownership cannot change. ${fix}`,
    where: "set"
  });
}
function claimedGroupSetError(label, group) {
  return new VGPUError2({
    code: "VGPU-R4-GROUP-CLAIMED",
    message: `group ${group} of '${label}' is claimed; set() cannot update it.`,
    fix: `Call set() first, or build from ${label}.layout(${group}); pass dynamic offsets to p.draw().`,
    where: `${label}.set`
  });
}
function claimedGroupIncompatibleError(label, group, reason, cause) {
  return new VGPUError2({
    code: "VGPU-R4-GROUP-INCOMPATIBLE",
    message: `claimed group ${group} in '${label}' is incompatible: ${reason}.`,
    fix: `Build from ${label}.layout(${group}, { dynamicOffsets? }) then call ${label}.group(${group}, bindGroup).`,
    where: `${label}.group`,
    cause
  });
}
function claimedGroupNativeValidationError(label, group, cause) {
  return new VGPUError2({
    code: "VGPU-R4-GROUP-VALIDATION",
    message: `WebGPU rejected claimed group ${group} in '${label}'.`,
    fix: `Build from ${label}.layout(${group}); pass offsets via p.draw(draw, { offsets: { ${group}: [...] } }).`,
    where: `${label}.draw`,
    cause,
    detail: { drawLabel: label, group }
  });
}
function blendInvalidError(label, value) {
  return new VGPUError2({
    code: "VGPU-BLEND-INVALID",
    message: `Invalid blend '${String(value)}' in '${label}'.`,
    fix: `Use "alpha", "additive", "premultiplied", or { color, alpha? } components.`,
    where: "draw"
  });
}
function blendConstantInvalidError(label, reason) {
  return new VGPUError2({
    code: "VGPU-BLEND-CONSTANT-INVALID",
    message: `Invalid blendConstant in '${label}': ${reason}`,
    fix: `Use [r, g, b, a] finite numbers with a blend whose color or alpha uses "constant"/"one-minus-constant"; omit it to keep the pass default (0, 0, 0, 0).`,
    where: "draw"
  });
}
function drawDisposedError(label, operation) {
  return new VGPUError2({
    code: "VGPU-DRAW-DISPOSED",
    message: `Draw '${label}' has been disposed.`,
    where: `${label}.${operation}`,
    fix: "Create a new draw(gpu, ...) or effect(gpu, ...); disposed render units cannot be reused.",
    detail: { label }
  });
}
function writeMaskInvalidError(label, preview2) {
  return new VGPUError2({
    code: "VGPU-WRITEMASK-INVALID",
    message: `Invalid writeMask ${preview2} in '${label}'.`,
    fix: `Use an array of r/g/b/a; omit it for all channels.`,
    where: "draw"
  });
}
function colorsInvalidError(label, reason, where = "draw") {
  return new VGPUError2({
    code: "VGPU-COLORS-INVALID",
    message: `Invalid colors in '${label}': ${reason}`,
    fix: `Use one { blend?, writeMask? } or null entry per color attachment of the target, aligned by index; omit colors to apply the top-level blend/writeMask to every attachment.`,
    where
  });
}
function cullInvalidError(label, value) {
  return new VGPUError2({
    code: "VGPU-CULL-INVALID",
    message: `Invalid cull '${String(value)}' in '${label}'.`,
    fix: `Use "none", "front", or "back"; omit it for no culling.`,
    where: "draw"
  });
}
function frontFaceInvalidError(label, value) {
  return new VGPUError2({
    code: "VGPU-FRONTFACE-INVALID",
    message: `Invalid frontFace '${String(value)}' in '${label}'.`,
    fix: `Use "ccw" or "cw"; omit it for counter-clockwise.`,
    where: "draw"
  });
}
function unclippedDepthInvalidError(label, reason) {
  return new VGPUError2({
    code: "VGPU-UNCLIPPED-DEPTH-INVALID",
    message: `Invalid unclippedDepth in '${label}': ${reason}`,
    fix: `Use a boolean. unclippedDepth: true needs the "depth-clip-control" device feature \u2014 request it with init({ requiredFeatures: ["depth-clip-control"] }) on an adapter that supports it. Omit the option to keep depth clipping.`,
    where: "draw"
  });
}
function depthInvalidError(label, reason) {
  return new VGPUError2({
    code: "VGPU-DEPTH-INVALID",
    message: `Invalid depth in '${label}': ${reason}`,
    fix: `Use false or { write?, compare?, bias?, biasSlopeScale?, biasClamp? }; omit it for { write: true, compare: "less-equal" }.`,
    where: "draw"
  });
}
function stencilInvalidError(label, reason, where = "draw") {
  return new VGPUError2({
    code: "VGPU-STENCIL-INVALID",
    message: `Invalid stencil in '${label}': ${reason}`,
    fix: `Use { front?, back?, readMask?, writeMask?, ref? } with GPUCompareFunction/GPUStencilOperation faces and u32 masks, against a target whose depth format has a stencil aspect (depth: "depth24plus-stencil8"); omit it for WebGPU's pass-through defaults.`,
    where
  });
}
function multisampleInvalidError(label, reason, where = "draw") {
  return new VGPUError2({
    code: "VGPU-MULTISAMPLE-INVALID",
    message: `Invalid multisample in '${label}': ${reason}`,
    fix: `Use { alphaToCoverage?, mask? }: alphaToCoverage needs a target created with msaa: true, and mask must be an integer in [0, 0xFFFFFFFF] (bits above the target's sampleCount are ignored). Omit multisample for full-coverage defaults.`,
    where
  });
}
function constantsInvalidError(label, reason, where = "draw") {
  return new VGPUError2({
    code: "VGPU-CONSTANTS-INVALID",
    message: `Invalid constants in '${label}': ${reason}`,
    fix: `Key WGSL \`override\` constants by name, or by the decimal string of N when the declaration has @id(N); values are finite numbers or booleans, converted to the override's WGSL type (bool/i32/u32/f32/f16). Every override without a default value must be provided. Omit constants to keep the WGSL defaults.`,
    where
  });
}
function entryInvalidError(label, reason, where = "draw") {
  return new VGPUError2({
    code: "VGPU-ENTRY-INVALID",
    message: `Invalid entry in '${label}': ${reason}`,
    fix: `Use a matching stage name: draw { vertex?, fragment? }, effect { fragment? }, compute string. Defaults prefer vs_main/fs_main/cs_main, otherwise first-in-stage.`,
    where
  });
}
function indirectInvalidError(label, reason, where) {
  return new VGPUError2({
    code: "VGPU-INDIRECT-INVALID",
    message: `Invalid indirect in '${label}': ${reason}`,
    fix: `Pass a storage buffer created with storage(gpu, bytes, { indirect: true }) \u2014 bare, or as { buffer, offset? } with a 4-aligned byte offset \u2014 sized so the GPU-read arguments fit: 16 bytes for drawIndirect, 20 for drawIndexedIndirect, 12 for dispatchWorkgroupsIndirect. Omit indirect to use CPU-side counts.`,
    where
  });
}
function passPreserveMsaaError() {
  return new VGPUError2({
    code: "VGPU-PASS-PRESERVE-MSAA",
    message: "clear:false cannot preserve MSAA; use a non-MSAA target.",
    fix: "Use non-MSAA for accumulation.",
    where: "Frame.pass"
  });
}
function passClearDepthInvalidError(value, reason = "expected a number in [0, 1].", fix = `Use 1 (default), or 0 with depth: { compare: "greater" } for reversed-Z.`) {
  return new VGPUError2({
    code: "VGPU-PASS-CLEARDEPTH-INVALID",
    message: `clearDepth received ${String(value)}; ${reason}`,
    fix,
    where: "Frame.pass"
  });
}
function passViewportInvalidError(reason) {
  return new VGPUError2({
    code: "VGPU-PASS-VIEWPORT-INVALID",
    message: `Invalid viewport: ${reason}`,
    fix: `Use { x?, y?, width, height, minDepth?, maxDepth? } finite numbers within device limits; omit it for the full target.`,
    where: "Frame.pass"
  });
}
function passScissorInvalidError(reason) {
  return new VGPUError2({
    code: "VGPU-PASS-SCISSOR-INVALID",
    message: `Invalid scissor: ${reason}`,
    fix: `Use [x, y, width, height] non-negative integers with x + width and y + height within the target's current pixel size; omit it for the full target.`,
    where: "Frame.pass"
  });
}
function passPreserveClearDepthError() {
  return new VGPUError2({
    code: "VGPU-PASS-PRESERVE-CLEARDEPTH",
    message: "clear:false preserves depth; clearDepth cannot apply.",
    fix: "Remove clearDepth, or let the pass clear.",
    where: "Frame.pass"
  });
}
function passClearStencilInvalidError(reason) {
  return new VGPUError2({
    code: "VGPU-PASS-CLEARSTENCIL-INVALID",
    message: `clearStencil ${reason}`,
    fix: `Use an integer in [0, 0xFFFFFFFF] on a target whose depth format has a stencil aspect, e.g. depth: "depth24plus-stencil8"; the value is masked to the stencil aspect's bit width.`,
    where: "Frame.pass"
  });
}
function passPreserveClearStencilError() {
  return new VGPUError2({
    code: "VGPU-PASS-PRESERVE-CLEARSTENCIL",
    message: "clear:false preserves stencil; clearStencil cannot apply.",
    fix: "Remove clearStencil, or let the pass clear.",
    where: "Frame.pass"
  });
}
function passDepthReadOnlyError(reason, fix, where = "Frame.pass") {
  return new VGPUError2({
    code: "VGPU-PASS-DEPTH-READONLY",
    message: `depthReadOnly ${reason}`,
    fix,
    where
  });
}
function passDepthReadOnlyMsaaError() {
  return new VGPUError2({
    code: "VGPU-PASS-DEPTH-READONLY-MSAA",
    message: `depthReadOnly cannot read an MSAA target's depth: multisampled depth is stored with storeOp "discard", so a read-only pass tests against discarded contents.`,
    fix: "Use a non-MSAA target for read-only depth, or drop depthReadOnly and let the pass own its depth.",
    where: "Frame.pass"
  });
}
function timerInvalidError(reason, fix, where = "timer") {
  return new VGPUError2({
    code: "VGPU-TIMER-INVALID",
    message: `Invalid timer use: ${reason}`,
    fix,
    where
  });
}
function visibilityInvalidError(reason, fix, where = "visibility") {
  return new VGPUError2({
    code: "VGPU-VIS-INVALID",
    message: `Invalid visibility use: ${reason}`,
    fix,
    where
  });
}
function queryNoVisibilityError() {
  return new VGPUError2({
    code: "VGPU-QUERY-NO-VISIBILITY",
    message: "occlusion() needs the pass to be opened with a visibility instance; the render pass has no occlusionQuerySet to write into.",
    fix: "Open the pass with f.pass({ target, visibility: vis }, ...) using the visibility(gpu) instance that created the query handle.",
    where: "FramePass.occlusion"
  });
}
function queryNestedError() {
  return new VGPUError2({
    code: "VGPU-QUERY-NESTED",
    message: "occlusion() cannot nest inside an active occlusion() body; WebGPU allows one active occlusion query per pass at a time.",
    fix: "Encode each occlusion scope sequentially: p.occlusion(a, ...); p.occlusion(b, ...).",
    where: "FramePass.occlusion"
  });
}
function targetRequiredError(where = "Frame.pass") {
  return new VGPUError2({
    code: "VGPU-TARGET-REQUIRED",
    message: "Target required. Fix: pass surface(gpu, canvas) or target(gpu, { size }) as { target }.",
    where
  });
}
function meshError(code, where, message, fix) {
  return new VGPUError2({ code, message: `${code}: ${message}`, fix, where });
}
function meshRangeInvalidError(where, message) {
  return meshError("VGPU-MESH-RANGE-INVALID", where, message, "Use index ranges for indexed geometries, vertex ranges otherwise, within geometry counts.");
}
function pipelineLayoutGapError(group) {
  return new VGPUError2({
    code: "VGPU-PIPELINE-LAYOUT-GAP",
    message: `Pipeline bind group ${group} is missing.`,
    fix: "Use consecutive @group() indices starting at 0.",
    where: "pipeline layout"
  });
}
function compileFailedError(where, cause, signature) {
  return new VGPUError2({
    code: "VGPU-COMPILE-FAILED",
    message: "WebGPU pipeline compilation failed.",
    fix: "Check WGSL, pipeline bindings, device limits, and render target/vertex layouts when applicable.",
    where,
    cause,
    detail: signature ? { signature } : void 0
  });
}
function compileDisposedError(where) {
  return new VGPUError2({
    code: "VGPU-COMPILE-DISPOSED",
    message: "GPU disposed during pipeline compilation.",
    where
  });
}
function compileSignatureInvalidError(where, reason) {
  return new VGPUError2({
    code: "VGPU-COMPILE-SIGNATURE-INVALID",
    message: `Invalid TargetSignature: ${reason}`,
    fix: "Pass { colors, depth?, sampleCount?:1|4 } or a Target.",
    where
  });
}
function targetStencilOnlyDepthError(format) {
  return new VGPUError2({
    code: "VGPU-TARGET-DEPTH-STENCIL-ONLY",
    message: `depth received '${format}'; stencil-only depth targets are not supported yet.`,
    fix: `Use a format with a depth aspect such as "depth24plus" or "depth24plus-stencil8".`,
    where: "target"
  });
}
function targetSizeRequiredError() {
  return new VGPUError2({
    code: "VGPU-TARGET-SIZE-REQUIRED",
    message: "Target size required. Fix: target(gpu, { size: [w,h] }); update surface-derived targets in onResize.",
    where: "target"
  });
}
function surfaceNotInFrameError(where) {
  return new VGPUError2({
    code: "VGPU-SURFACE-NOT-IN-FRAME",
    message: "Surface targets are only available inside frame(gpu).",
    fix: "Encode surface draws inside frame(gpu, ...); compile(surface) and bundle(gpu, { target: surface }, ...) can prepare outside a frame.",
    where
  });
}
function surfaceDepthInvalidError(received) {
  return new VGPUError2({
    code: "VGPU-SURFACE-DEPTH-INVALID",
    message: "Surface depth must be false, true, or a depth-aspect texture format.",
    fix: 'Use depth: true, a depth-aspect format such as "depth24plus", or omit depth.',
    where: "surface",
    detail: { actual: typeof received === "string" || typeof received === "number" ? received : void 0, type: typeof received }
  });
}
function surfaceMsaaInvalidError(received) {
  return new VGPUError2({
    code: "VGPU-SURFACE-MSAA-INVALID",
    message: "Surface msaa must be false, true, or 4.",
    fix: "Use msaa: false for one sample, msaa: true or msaa: 4 for four samples, or omit msaa.",
    where: "surface",
    detail: { actual: typeof received === "string" || typeof received === "number" ? received : void 0, type: typeof received }
  });
}
function surfaceContextError() {
  return new VGPUError2({
    code: "VGPU-SURFACE-CONTEXT",
    message: "Canvas WebGPU context failed. Fix: check navigator.gpu and remove any existing 2d/webgl context.",
    where: "surface"
  });
}
function surfaceDuplicateError(label) {
  return new VGPUError2({
    code: "VGPU-SURFACE-DUPLICATE",
    message: `Canvas already has surface${label ? ` '${label}'` : ""}. Fix: reuse or dispose it.`,
    where: "surface"
  });
}
function surfaceDisposedError(label) {
  return new VGPUError2({
    code: "VGPU-SURFACE-DISPOSED",
    message: `Surface '${label ?? "surface"}' is disposed. Fix: call surface(gpu, canvas).`,
    where: "surface"
  });
}
function surfaceAutoResizeUnsupportedError() {
  return new VGPUError2({
    code: "VGPU-SURFACE-AUTORESIZE-UNSUPPORTED",
    message: "autoResize needs clientWidth. Fix: call surface.resize([w,h]) for OffscreenCanvas; onResize still fires.",
    where: "surface"
  });
}
function surfaceResizeReentrantError(label) {
  return new VGPUError2({
    code: "VGPU-SURFACE-RESIZE-REENTRANT",
    message: `Cannot resize this surface${label ? ` '${label}'` : ""} in onResize. Fix: resize derived targets only.`,
    where: "surface.resize"
  });
}
function clearColorInvalidError(where) {
  return new VGPUError2({
    code: "VGPU-CLEAR-COLOR-INVALID",
    message: `Invalid ${where}: expected four finite numbers.`,
    fix: "Assign [r, g, b, a] or a GPUColor object ({ r, g, b, a }).",
    where
  });
}
function asyncFrameCallbackError(where) {
  return new VGPUError2({
    code: "VGPU-ASYNC-FRAME-CALLBACK",
    message: `${where} callbacks must be synchronous.`,
    where,
    fix: "Await preparation before frame()/frameLoop(); keep the frame callback synchronous."
  });
}
function frameReentrantError() {
  return new VGPUError2({
    code: "VGPU-FRAME-REENTRANT",
    message: "Nested frame(gpu) is invalid. Fix: queue work for the next frame.",
    where: "frame"
  });
}
function frameCanceledError(where) {
  return new VGPUError2({
    code: "VGPU-FRAME-CANCELED",
    message: "the frame was canceled; its command encoder was dropped and nothing more can be encoded or submitted on it.",
    fix: "Open a new frame(gpu) for further work; cancel() is the last operation on a frame.",
    where
  });
}
function framePassActiveError(where) {
  return new VGPUError2({
    code: "VGPU-FRAME-PASS-ACTIVE",
    message: "the frame cannot be canceled while a pass callback is active.",
    fix: "Return from the frame.pass(...) callback first, then call frame.cancel(); this keeps pass descriptor resources alive until the pass is closed.",
    where
  });
}
function frameAlreadySubmittedError(where) {
  return new VGPUError2({
    code: "VGPU-FRAME-SUBMITTED",
    message: "the frame was already submitted; submitted GPU work cannot be canceled.",
    fix: "Call cancel() only on a frame you decided not to submit; the frame you did submit needs no cleanup.",
    where
  });
}
function incompatibleResourceError(binding, expected, fix) {
  return new VGPUError2({
    code: "VGPU-R1-BINDING-INCOMPATIBLE-RESOURCE",
    message: `binding \`${binding.name}\` @group(${binding.group}) @binding(${binding.binding}) needs ${expected}.`,
    fix,
    where: "set"
  });
}
function unsupportedError(where, message, fix) {
  return new VGPUError2({ code: "VGPU-RING1-UNSUPPORTED", message, fix, where });
}
function setValueInvalidError(detail, message) {
  return new VGPUError2({
    code: "VGPU-SET-VALUE-INVALID",
    message: `Invalid WGSL value at '${detail.path}': ${message}.`,
    fix: "Pass the exact reflected structure, vector, matrix, and array shapes; use integral in-range values for i32/u32.",
    where: "set",
    detail
  });
}
function unpreparedShaderSourceError() {
  return new VGPUError2({
    code: "VGPU-SHADER-SOURCE-UNPREPARED",
    message: "The renderer requires a prepared ShaderSource v2, but received raw WGSL or a v1 artifact.",
    fix: "Use a compatible @vgpu/wgsl loader, rebuild shader assets, or call prepareShader() from @vgpu/wgsl/prepare.",
    where: "shader source"
  });
}
function unsupportedShaderSourceVersionError(version, producer) {
  return new VGPUError2({
    code: "VGPU-SHADER-SOURCE-VERSION",
    message: `ShaderSource version ${version} is unsupported; this runtime supports version 2${producer ? ` (producer: ${producer})` : ""}.`,
    fix: "Align the shader producer and vgpu runtime versions, then regenerate the artifact.",
    where: "shader source",
    detail: { actual: version, expected: 2, reason: producer ? `producer: ${producer}` : void 0 }
  });
}
function invalidShaderSourceError(field, reason) {
  return new VGPUError2({
    code: "VGPU-SHADER-SOURCE-INVALID",
    message: `Invalid ShaderSource field '${field}': ${reason}.`,
    fix: "Regenerate the shader artifact with a compatible @vgpu/wgsl producer.",
    where: "shader source",
    detail: { path: field, reason }
  });
}
function sharedUniformLayoutMismatchError(opts) {
  return new VGPUError2({
    code: "VGPU-R1-SHARED-UNIFORMS-LAYOUT-MISMATCH",
    message: `Uniform '${opts.bindingName}' layout ${opts.adoptedLayout} from ${opts.adoptedSource} != ${opts.incomingLayout} from ${opts.incomingSource}. Fix: align structs or split uniforms.`,
    where: "uniforms"
  });
}
function missingBindingFix(drawLabel, binding) {
  switch (binding.kind) {
    case "sampler":
      return `${drawLabel}.set({${binding.name}:sampler(gpu)})`;
    case "texture":
      return `${drawLabel}.set({${binding.name}:scene.color})`;
    case "buffer":
      return binding.addressSpace === "uniform" ? `${drawLabel}.set({${binding.name}:{ /* values */ }})` : `${drawLabel}.set({${binding.name}:buffer})`;
    default:
      return `${drawLabel}.set({${binding.name}:resource})`;
  }
}

// node_modules/vgpu/dist/lifecycle.js
function assertDeviceUsable(device, where) {
  device.assertUsable(where);
}
function isDeviceUsable(device) {
  try {
    assertDeviceUsable(device, "Device");
    return true;
  } catch {
    return false;
  }
}
function assertBufferUsable(buffer, where, device) {
  buffer.assertUsable(where, device);
}

// node_modules/vgpu/dist/submitted-work-done.js
function submittedWorkDone(device) {
  try {
    return device.gpu.queue.onSubmittedWorkDone?.() ?? Promise.resolve();
  } catch (error) {
    return Promise.reject(error);
  }
}

// node_modules/vgpu/dist/kernel.js
var PHASES = ["scheduler", "resource", "service"];
function serviceToken(name) {
  return { name };
}
var kernels = /* @__PURE__ */ new WeakMap();
function kernelOf(gpu) {
  const kernel = kernels.get(gpu);
  if (!kernel) {
    throw new VGPUError2({
      code: "VGPU-GPU-FOREIGN",
      message: "This object was not created by init(); it has no vgpu kernel.",
      fix: "Pass the gpu returned by init() from vgpu, vgpu/node or vgpu/mock.",
      where: "gpu"
    });
  }
  return kernel;
}
var KernelImpl = class {
  device;
  #services = /* @__PURE__ */ new Map();
  #owners = new Map(PHASES.map((phase) => [phase, /* @__PURE__ */ new Set()]));
  #errorListeners = /* @__PURE__ */ new Set();
  #pendingDeliveries = /* @__PURE__ */ new Set();
  #settledSources = /* @__PURE__ */ new Set();
  #lossStops = /* @__PURE__ */ new Set();
  #releaseDeviceLoss;
  #resolveLost;
  lost;
  #disposed = false;
  #lossInfo;
  constructor(device) {
    this.device = device;
    let resolveLost;
    this.lost = new Promise((resolve) => {
      resolveLost = resolve;
    });
    this.#resolveLost = resolveLost;
    this.#releaseDeviceLoss = onObservedDeviceLoss(device, (info) => {
      if (this.#disposed || this.#lossInfo)
        return;
      this.#lossInfo = info;
      const stops = [...this.#lossStops];
      this.#lossStops.clear();
      for (const stop of stops) {
        try {
          stop();
        } catch {
        }
      }
      this.#resolveLost(info);
    });
  }
  get disposed() {
    return this.#disposed;
  }
  service(token, factory) {
    const existing = this.#services.get(token);
    if (existing !== void 0)
      return existing;
    const created = factory(this);
    this.#services.set(token, created);
    return created;
  }
  peekService(token) {
    return this.#services.get(token);
  }
  own(phase, disposer) {
    const set = this.#owners.get(phase);
    set.add(disposer);
    return () => {
      set.delete(disposer);
    };
  }
  stopOnLoss(stop) {
    if (this.#lossInfo || this.#disposed) {
      stop();
      return () => void 0;
    }
    this.#lossStops.add(stop);
    return () => {
      this.#lossStops.delete(stop);
    };
  }
  addErrorListener(cb) {
    this.#errorListeners.add(cb);
    return () => {
      this.#errorListeners.delete(cb);
    };
  }
  reportError(error) {
    if (this.#disposed)
      return Promise.resolve();
    const delivery = Promise.resolve().then(() => {
      const listeners = [...this.#errorListeners];
      if (!listeners.length) {
        console.error(error);
        return;
      }
      for (const listener of listeners) {
        try {
          listener(error);
        } catch (listenerError) {
          console.error(listenerError);
        }
      }
    });
    return this.trackDelivery(delivery);
  }
  trackDelivery(promise) {
    const tracked = Promise.resolve(promise).then(() => void 0, (error) => {
      console.error(error);
    });
    this.#pendingDeliveries.add(tracked);
    void tracked.finally(() => this.#pendingDeliveries.delete(tracked));
    return tracked;
  }
  registerSettledSource(source) {
    this.#settledSources.add(source);
    return () => {
      this.#settledSources.delete(source);
    };
  }
  async settled() {
    const queueFence = !this.#disposed && isDeviceUsable(this.device) ? submittedWorkDone(this.device) : void 0;
    const sources = [...this.#settledSources];
    const snapshot = [
      ...this.#pendingDeliveries,
      ...sources.flatMap((source) => {
        try {
          return source();
        } catch (error) {
          return [Promise.reject(error)];
        }
      })
    ];
    if (queueFence)
      snapshot.push(queueFence);
    await Promise.allSettled(snapshot);
  }
  dispose() {
    if (this.#disposed)
      return;
    this.#disposed = true;
    this.#releaseDeviceLoss();
    for (const phase of PHASES) {
      const set = this.#owners.get(phase);
      for (const disposer of [...set])
        disposer();
      set.clear();
    }
    this.#services.clear();
    this.#settledSources.clear();
    this.#lossStops.clear();
    this.#errorListeners.clear();
    this.device.dispose();
  }
};
function attachKernel(device) {
  const kernel = new KernelImpl(device);
  const gpu = {
    device,
    gpu: device.gpu,
    lost: kernel.lost,
    get disposed() {
      return kernel.disposed;
    },
    onError: (cb) => kernel.addErrorListener(cb),
    settled: () => kernel.settled(),
    dispose: () => {
      kernel.dispose();
    }
  };
  kernels.set(gpu, kernel);
  return gpu;
}
function onObservedDeviceLoss(device, observer) {
  return device.onObservedLoss(observer);
}
async function createCoreGpu(entry, opts = {}, adapterFactory) {
  return attachKernel(await createDevice(entry, opts, adapterFactory));
}
async function createDevice(entry, opts, adapterFactory) {
  if (opts.adapter || adapterFactory)
    return (opts.adapter ?? adapterFactory()).requestDevice(opts);
  if (entry === "browser")
    return requestBrowserDevice(opts);
  throw unsupportedError("init", `init(${entry}) requires adapterFactory.`);
}
async function requestBrowserDevice(opts) {
  const nav = globalThis.navigator;
  const adapter = await nav.gpu?.requestAdapter({ powerPreference: opts.powerPreference });
  if (!adapter)
    throw unsupportedError("init", "navigator.gpu.requestAdapter() returned null.");
  validateRequiredFeatures(adapter.features, opts.requiredFeatures);
  const gpuDevice = await adapter.requestDevice({ requiredFeatures: opts.requiredFeatures, requiredLimits: opts.requiredLimits });
  return new Device(gpuDevice, adapter.info ?? null);
}

// node_modules/vgpu/dist/draw-protocols.js
var BINDING_RESOURCE = /* @__PURE__ */ Symbol("vgpu.bindingResource");
function bindingResourceOf(value) {
  const method = typeof value === "object" && value !== null ? value[BINDING_RESOURCE] : void 0;
  return typeof method === "function" ? value : void 0;
}
var SURFACE_TARGET = /* @__PURE__ */ Symbol("vgpu.surfaceTarget");
function isSurfaceTarget(value) {
  return typeof value === "object" && value !== null && value[SURFACE_TARGET] === true;
}
var TARGET_SIGNATURE = /* @__PURE__ */ Symbol("vgpu.targetSignature");
function targetSignatureOf(value) {
  const method = typeof value === "object" && value !== null ? value[TARGET_SIGNATURE] : void 0;
  return typeof method === "function" ? method.call(value) : void 0;
}
var geometryLayoutResolver = /* @__PURE__ */ Symbol("vgpu.geometry.layoutResolver");
var geometryLiveness = /* @__PURE__ */ Symbol("vgpu.geometry.liveness");
function geometryLivenessOf(value) {
  const method = typeof value === "object" && value !== null ? value[geometryLiveness] : void 0;
  return typeof method === "function" ? value : void 0;
}

// node_modules/vgpu/dist/live-kernel.js
function liveKernel(gpu, where) {
  const kernel = kernelOf(gpu);
  if (kernel.disposed)
    throw gpuDisposedError(where);
  assertDeviceUsable(kernel.device, where);
  return kernel;
}
function gpuDisposedError(where) {
  return new VGPUError2({
    code: "VGPU-GPU-DISPOSED",
    message: `${where}() ran after gpu.dispose(); the device and everything it owned are gone.`,
    fix: "Create resources before disposing the gpu, or init() a new one.",
    where
  });
}
function ownResource(kernel, resource, destroy, onDestroyed) {
  const release = kernel.own("resource", () => destroy(resource));
  onDestroyed?.(release);
  return resource;
}

// node_modules/vgpu/dist/binding-lifetime.js
var MAINTENANCE_BUDGET = 16;
var internals = /* @__PURE__ */ new WeakMap();
function createBindingLifetimeService() {
  const markers = /* @__PURE__ */ new WeakMap();
  const state = {
    records: /* @__PURE__ */ new Map(),
    dependencies: /* @__PURE__ */ new Map(),
    markerRefs: /* @__PURE__ */ new Map(),
    markerFinalizer: new FinalizationRegistry((marker) => state.markerRefs.delete(marker)),
    finalizer: new FinalizationRegistry((record) => removeRecord(state, record)),
    nextRecord: 1,
    nextMarker: 1,
    maintenanceVisits: 0,
    targetedVisits: 0,
    disposed: false
  };
  const service = {
    destroyEpoch: 0,
    marker(resource, dependency, subscribe) {
      let marker = markers.get(resource);
      if (marker)
        return marker;
      service.maintain();
      marker = { dependency, destroyed: false };
      markers.set(resource, marker);
      const markerId = state.nextMarker++;
      const markerRef = new WeakRef(marker);
      state.markerRefs.set(markerId, markerRef);
      state.markerFinalizer.register(marker, markerId, markerRef);
      const serviceRef = new WeakRef(service);
      marker.unsubscribe = subscribeMarker(subscribe, marker, markerId, markerRef, serviceRef);
      return marker;
    },
    register(target2, dependencies) {
      if (state.disposed)
        return void 0;
      service.maintain();
      if (dependencies.length === 0)
        return void 0;
      const id = state.nextRecord++;
      const record = {
        id,
        target: new WeakRef(target2),
        dependencies: [...new Set(dependencies)],
        token: {}
      };
      appendRecord(state, record);
      for (const dependency of record.dependencies) {
        let bucket = state.dependencies.get(dependency);
        if (!bucket)
          state.dependencies.set(dependency, bucket = /* @__PURE__ */ new Set());
        bucket.add(id);
      }
      state.finalizer.register(target2, id, record.token);
      return id;
    },
    unregister(record) {
      if (record !== void 0)
        removeRecord(state, record);
    },
    invalidate(dependency, filter) {
      service.maintain();
      const bucket = state.dependencies.get(dependency);
      if (!bucket)
        return;
      for (const id of [...bucket]) {
        state.targetedVisits += 1;
        const record = state.records.get(id);
        if (!record)
          continue;
        const target2 = record.target.deref();
        if (target2 && filter && !filter(target2))
          continue;
        if (target2)
          target2.invalidateLifetime(id, dependency);
        removeRecord(state, id);
      }
    },
    maintain() {
      if (state.disposed || state.head === void 0)
        return;
      let id = state.cursor ?? state.head;
      for (let visited = 0; visited < MAINTENANCE_BUDGET && state.head !== void 0; visited += 1) {
        const record = state.records.get(id);
        if (!record) {
          id = state.head;
          continue;
        }
        state.maintenanceVisits += 1;
        const next = record.next ?? state.head;
        if (!record.target.deref())
          removeRecord(state, id);
        if (state.head === void 0)
          break;
        id = state.records.has(next) ? next : state.head;
      }
      state.cursor = state.head === void 0 ? void 0 : id;
    },
    dispose() {
      if (state.disposed)
        return;
      state.disposed = true;
      service.destroyEpoch++;
      for (const reference of state.markerRefs.values()) {
        state.markerFinalizer.unregister(reference);
        reference.deref()?.unsubscribe?.();
      }
      state.markerRefs.clear();
      for (const id of [...state.records.keys()])
        removeRecord(state, id);
      state.dependencies.clear();
      state.head = void 0;
      state.cursor = void 0;
    }
  };
  internals.set(service, state);
  return service;
}
function subscribeMarker(subscribe, marker, markerId, unregisterToken, serviceRef) {
  return subscribe(() => {
    if (marker.destroyed)
      return;
    marker.destroyed = true;
    const service = serviceRef.deref();
    const state = service && internals.get(service);
    if (!service || !state)
      return;
    state.markerFinalizer.unregister(unregisterToken);
    state.markerRefs.delete(markerId);
    service.destroyEpoch++;
    service.invalidate(marker.dependency);
  });
}
function appendRecord(state, record) {
  if (state.head === void 0) {
    record.previous = record.id;
    record.next = record.id;
    state.head = record.id;
    state.cursor = record.id;
  } else {
    const head = state.records.get(state.head);
    const tail = state.records.get(head.previous);
    record.previous = tail.id;
    record.next = head.id;
    tail.next = record.id;
    head.previous = record.id;
  }
  state.records.set(record.id, record);
}
function removeRecord(state, id) {
  const record = state.records.get(id);
  if (!record)
    return;
  state.finalizer.unregister(record.token);
  for (const dependency of record.dependencies) {
    const bucket = state.dependencies.get(dependency);
    bucket?.delete(id);
    if (bucket?.size === 0)
      state.dependencies.delete(dependency);
  }
  if (record.next === id) {
    state.head = void 0;
    state.cursor = void 0;
  } else {
    const previous = state.records.get(record.previous);
    const next = state.records.get(record.next);
    if (previous)
      previous.next = record.next;
    if (next)
      next.previous = record.previous;
    if (state.head === id)
      state.head = record.next;
    if (state.cursor === id)
      state.cursor = record.next;
  }
  state.records.delete(id);
}

// node_modules/vgpu/dist/bind-cache.js
var CAPTURE_PAGE_KIND = "uniform-page";
var MAX_OWNER_ENTRIES = 64;
var MAX_CAPTURE_VARIANTS = 16;
var CacheEntry = class {
  cache;
  shard;
  group;
  layout;
  key;
  capture;
  bindGroup;
  record;
  used = ++clock;
  constructor(cache, shard, group, layout, key, capture, bindGroup) {
    this.cache = cache;
    this.shard = shard;
    this.group = group;
    this.layout = layout;
    this.key = key;
    this.capture = capture;
    this.bindGroup = bindGroup;
  }
  invalidateLifetime() {
    removeEntry(this.cache, this);
  }
};
var states = /* @__PURE__ */ new WeakMap();
var clock = 0;
function bindGroupClock() {
  return clock;
}
function createBindGroupCache() {
  const state = { lifetime: createBindingLifetimeService(), shards: /* @__PURE__ */ new WeakMap(), disposed: false };
  const cache = {
    lifetime: state.lifetime,
    getOrCreate(owner, group, layout, bindings, dependencies, factory, key = bindGroupKeyOf(bindings)) {
      let shard = state.shards.get(owner);
      if (!shard) {
        shard = { groups: /* @__PURE__ */ new Map(), lru: /* @__PURE__ */ new Map(), captures: /* @__PURE__ */ new Map() };
        state.shards.set(owner, shard);
      }
      let layouts = shard.groups.get(group);
      if (!layouts)
        shard.groups.set(group, layouts = /* @__PURE__ */ new Map());
      let entries = layouts.get(layout);
      if (!entries)
        layouts.set(layout, entries = /* @__PURE__ */ new Map());
      const existing = entries.get(key);
      if (existing) {
        existing.used = ++clock;
        return existing.bindGroup;
      }
      const capture = bindings.some(({ key: key2 }) => isCapturedRange(key2));
      const entry = new CacheEntry(state, new WeakRef(shard), group, layout, key, capture, factory());
      entries.set(key, entry);
      shard.lru.set(entry, true);
      entry.record = state.lifetime.register(entry, dependencies.map(baseIdentityKey));
      if (capture) {
        let variants = shard.captures.get(group);
        if (!variants)
          shard.captures.set(group, variants = /* @__PURE__ */ new Map());
        variants.set(entry, true);
        if (variants.size > MAX_CAPTURE_VARIANTS)
          removeEntry(state, leastRecent(variants));
      }
      if (shard.lru.size > MAX_OWNER_ENTRIES)
        removeEntry(state, leastRecent(shard.lru));
      return entry.bindGroup;
    },
    marker(resource, identity, subscribe) {
      return state.lifetime.marker(resource, baseIdentityKey(identity), subscribe);
    },
    evictIdentity(identity, unusedSince) {
      state.lifetime.invalidate(baseIdentityKey(identity), unusedSince === void 0 ? void 0 : (target2) => !(target2 instanceof CacheEntry) || target2.used <= unusedSince);
    },
    clearOwner(owner, group) {
      state.lifetime.maintain();
      const shard = state.shards.get(owner);
      if (!shard)
        return;
      for (const entry of [...shard.lru.keys()])
        if (group === void 0 || entry.group === group)
          removeEntry(state, entry);
      if (group === void 0)
        state.shards.delete(owner);
    },
    dispose() {
      if (state.disposed)
        return;
      state.disposed = true;
      state.shards = /* @__PURE__ */ new WeakMap();
      state.lifetime.dispose();
    }
  };
  states.set(cache, state);
  return cache;
}
var keys = /* @__PURE__ */ new WeakMap();
var keyBuilds = 0;
function identityKey(identity) {
  if (typeof identity === "string" || typeof identity === "number")
    return `${typeof identity}:${String(identity)}`;
  let key = keys.get(identity);
  if (key === void 0) {
    key = `${identity.kind}:${identity.id}`;
    if ("offset" in identity)
      key += `@${identity.offset}+${identity.size}`;
    keys.set(identity, key);
  }
  return key;
}
function baseIdentityKey(identity) {
  if (typeof identity === "string" || typeof identity === "number")
    return `${typeof identity}:${String(identity)}`;
  return `${identity.kind}:${identity.id}`;
}
function leastRecent(entries) {
  let oldest;
  for (const entry of entries.keys())
    if (!oldest || entry.used < oldest.used)
      oldest = entry;
  return oldest;
}
function bindGroupKeyOf(bindings) {
  keyBuilds++;
  let sorted = true;
  for (let index = 1; index < bindings.length; index++)
    if (bindings[index - 1].binding > bindings[index].binding)
      sorted = false;
  const ordered = sorted ? bindings : [...bindings].sort((left, right) => left.binding - right.binding);
  let key = "";
  for (const { binding, key: identity } of ordered) {
    const part = identityKey(identity);
    key += `${binding}:${part.length}:${part}`;
  }
  return key;
}
function isCapturedRange(identity) {
  return typeof identity === "object" && identity.kind === CAPTURE_PAGE_KIND;
}
function removeEntry(state, entry) {
  state.lifetime.unregister(entry.record);
  entry.record = void 0;
  const shard = entry.shard.deref();
  if (!shard)
    return;
  const layouts = shard.groups.get(entry.group);
  const entries = layouts?.get(entry.layout);
  if (entries?.get(entry.key) !== entry)
    return;
  entries.delete(entry.key);
  shard.lru.delete(entry);
  const variants = entry.capture ? shard.captures.get(entry.group) : void 0;
  variants?.delete(entry);
  if (variants?.size === 0)
    shard.captures.delete(entry.group);
  if (entries.size === 0)
    layouts.delete(entry.layout);
  if (layouts?.size === 0)
    shard.groups.delete(entry.group);
}

// node_modules/vgpu/dist/entry-metadata.js
function entryMetadata(entry, field, where) {
  const value = entry[field];
  if (!value) {
    throw new VGPUError2({
      code: "VGPU-REFLECT-ENTRY-METADATA-MISSING",
      message: `Entry point '${entry.name}' has no reflected ${field}.`,
      fix: "Pass the reflection from reflectSource()/resolveShader().",
      where
    });
  }
  return value;
}

// node_modules/vgpu/dist/claim-validation.js
var pendingScopes = /* @__PURE__ */ new WeakMap();
function pushClaimedGroupValidationScope(device, context) {
  if (!device.gpu.pushErrorScope || !device.gpu.popErrorScope)
    return;
  device.gpu.pushErrorScope("validation");
  const pending = pendingScopes.get(device.gpu);
  if (pending)
    pending.push(context);
  else
    pendingScopes.set(device.gpu, [context]);
}
function popLastClaimedGroupValidationScope(device) {
  const pending = pendingScopes.get(device.gpu);
  if (!pending?.length || !device.gpu.popErrorScope)
    return void 0;
  const context = pending.pop();
  if (!pending.length)
    pendingScopes.delete(device.gpu);
  return { context, error: device.gpu.popErrorScope() };
}
function popClaimedGroupValidationScopes(device) {
  const results = [];
  let result = popLastClaimedGroupValidationScope(device);
  while (result) {
    results.push(result);
    result = popLastClaimedGroupValidationScope(device);
  }
  return results;
}
function discardLastClaimedGroupValidationScope(device) {
  const result = popLastClaimedGroupValidationScope(device);
  if (result)
    suppressClaimedGroupValidationResult(result);
}
function discardClaimedGroupValidationScopes(device) {
  for (const result of popClaimedGroupValidationScopes(device))
    suppressClaimedGroupValidationResult(result);
}
function discardClaimedGroupValidationResults(results) {
  for (const result of results)
    suppressClaimedGroupValidationResult(result);
}
function claimedGroupValidationDone(device, results = [], opts = {}) {
  return settleClaimedGroupValidations(device, results, opts.errorSink ?? defaultErrorSink);
}
function preferClaimedGroupValidationResult(preferred, fallback) {
  return {
    context: preferred.context,
    error: preferValidationError(preferred.error, fallback.error)
  };
}
async function preferValidationError(preferred, fallback) {
  const results = await Promise.allSettled([preferred, fallback]);
  for (const result of results) {
    if (result.status === "fulfilled" && result.value)
      return result.value;
  }
  const rejection = results.find((result) => result.status === "rejected");
  if (rejection?.status === "rejected")
    throw rejection.reason;
  return null;
}
async function settleClaimedGroupValidations(device, results, errorSink) {
  await submittedWorkDone(device);
  for (const result of results) {
    try {
      const error = await result.error;
      if (error)
        await errorSink(claimedGroupNativeValidationError(result.context.label, result.context.group, error));
    } catch (error) {
      await errorSink(claimedGroupNativeValidationError(result.context.label, result.context.group, error));
    }
  }
}
function suppressClaimedGroupValidationResult(result) {
  void result.error.catch(() => void 0);
}
function defaultErrorSink(error) {
  console.error(error);
}

// node_modules/vgpu/dist/claim-validation-encode.js
function endRenderPassWithClaimValidation(device, pass, validations2, fallbackContext) {
  try {
    pass.end();
  } catch (error) {
    const scopes = popClaimedGroupValidationScopes(device);
    discardClaimedGroupValidationResults(validations2);
    discardClaimedGroupValidationResults(scopes);
    validations2.length = 0;
    const context = scopes[0]?.context ?? fallbackContext;
    if (context)
      throw claimedGroupNativeValidationError(context.label, context.group, error);
    throw error;
  }
}

// node_modules/vgpu/dist/binding-views.js
var TextureViewVariants = class {
  // Descriptor keys are a finite generated set. Weak values let inert keys outlive an abandoned
  // cache/service on a retained Texture without keeping native view wrappers alive.
  views = /* @__PURE__ */ new Map();
  registered = /* @__PURE__ */ new WeakSet();
  destroyed = false;
  invalidateLifetime() {
    this.destroyed = true;
    this.views.clear();
  }
};
var records = /* @__PURE__ */ new WeakMap();
function bindingTextureView(texture, descriptor, cache, device) {
  const canonical = canonicalViewDescriptor(texture, descriptor);
  if (canonical.defaultEquivalent)
    return { view: texture.view, key: canonical.key };
  void texture.view;
  void device.limits;
  let variants = records.get(texture);
  if (!variants) {
    variants = new TextureViewVariants();
    records.set(texture, variants);
  }
  if (!variants.registered.has(cache.lifetime)) {
    const marker = cache.marker(texture, texture.resourceIdentity, (callback) => texture.onDestroy(callback));
    cache.lifetime.register(variants, [marker.dependency]);
    variants.registered.add(cache.lifetime);
  }
  if (variants.destroyed)
    return { view: texture.createView(descriptor), key: canonical.key };
  let view = variants.views.get(canonical.key)?.deref();
  if (!view) {
    view = texture.createView(descriptor);
    variants.views.set(canonical.key, new WeakRef(view));
  }
  return { view, key: canonical.key };
}
function canonicalViewDescriptor(texture, descriptor) {
  const dimension = descriptor?.dimension ?? defaultDimension(texture);
  const baseMipLevel = descriptor?.baseMipLevel ?? 0;
  const mipLevelCount = descriptor?.mipLevelCount ?? texture.mipLevelCount - baseMipLevel;
  const baseArrayLayer = descriptor?.baseArrayLayer ?? 0;
  const arrayLayerCount = descriptor?.arrayLayerCount ?? defaultLayerCount(texture, dimension, baseArrayLayer);
  const aspect = descriptor?.aspect ?? "all";
  const usage = descriptor?.usage === void 0 || descriptor.usage === 0 ? texture.gpu.usage : descriptor.usage;
  const swizzle = descriptor?.swizzle ?? "rgba";
  const format = descriptor?.format ?? "@default";
  const fields = { format, dimension, aspect, baseMipLevel, mipLevelCount, baseArrayLayer, arrayLayerCount, usage, swizzle };
  const defaults = {
    format: "@default",
    dimension: defaultDimension(texture),
    aspect: "all",
    baseMipLevel: 0,
    mipLevelCount: texture.mipLevelCount,
    baseArrayLayer: 0,
    arrayLayerCount: defaultLayerCount(texture, defaultDimension(texture), 0),
    usage: texture.gpu.usage,
    swizzle: "rgba"
  };
  return { key: JSON.stringify(fields), defaultEquivalent: JSON.stringify(fields) === JSON.stringify(defaults) };
}
function defaultDimension(texture) {
  return texture.kind === "2d-array" ? "2d-array" : texture.kind;
}
function defaultLayerCount(texture, dimension, baseArrayLayer) {
  return dimension === "2d-array" || dimension === "cube" || dimension === "cube-array" ? texture.layers - baseArrayLayer : 1;
}

// node_modules/vgpu/dist/set-resources.js
var nextSyntheticResourceId = 1;
var syntheticIds = /* @__PURE__ */ new WeakMap();
function isPlainValue(value) {
  if (value === null)
    return true;
  if (typeof value !== "object")
    return true;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || Array.isArray(value))
    return true;
  if (value instanceof Buffer || value instanceof Texture)
    return false;
  if (bindingResourceOf(value))
    return false;
  if (isRawGPUBuffer(value) || isGPUBufferBinding(value))
    return false;
  return !hasAnyResourceShape(value);
}
function isPlainObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer)
    return false;
  if (value instanceof Buffer || value instanceof Texture)
    return false;
  if (bindingResourceOf(value))
    return false;
  if (isRawGPUBuffer(value) || isGPUBufferBinding(value))
    return false;
  return !hasAnyResourceShape(value);
}
function normalizeResource(binding, value, context) {
  assertResourceBindable(binding, value, context.sourceHint);
  try {
    return normalizeLiveResource(binding, value, context);
  } catch (error) {
    const code = error?.code;
    if (code === "VGPU-CORE-TEXTURE-DESTROYED" || code === "VGPU-BUFFER-DISPOSED") {
      const label = code === "VGPU-BUFFER-DISPOSED" ? trackedBufferLabel(value) : value instanceof Texture ? value.label : asTarget(value)?.color.label;
      throw destroyedBindingError(context.sourceHint, binding, label);
    }
    throw error;
  }
}
function normalizeLiveResource(binding, value, context) {
  assertResourceBindable(binding, value, context.sourceHint);
  switch (binding.bindingLayout?.kind) {
    case "buffer":
      return normalizeBufferResource(binding, value, context);
    case "texture":
      return normalizeTextureResource(binding, value, context);
    case "sampler":
      return normalizeSamplerResource(binding, value);
    case "storageTexture":
      return normalizeStorageTextureResource(binding, value, context);
    case "externalTexture":
      throw incompatibleResourceError(binding, "external texture", "Pass a compatible GPUExternalTexture.");
    default:
      throw incompatibleResourceError(binding, "reflected resource", "Fix shader reflection bindingLayout.");
  }
}
function assertResourceBindable(binding, value, label) {
  if (isSurfaceTarget(value))
    throw surfaceNotBindableError(label, binding);
}
function normalizeBufferResource(binding, value, context) {
  const provider = bindingResourceOf(value);
  if (provider)
    return normalizeBufferBinding(binding, provider[BINDING_RESOURCE](binding, context.sourceHint), context);
  if (value instanceof Buffer) {
    assertBufferUsable(value, `${context.sourceHint}.set`);
    return normalizeBufferBinding(binding, {
      resourceLabel: value.options.label ?? value.gpu.label,
      resource: { buffer: value.gpu },
      identity: value.resourceIdentity,
      tracked: [trackedResource(value, value.resourceIdentity)]
    }, context);
  }
  if (isUniformLike(value)) {
    assertBufferUsable(value.buffer, `${context.sourceHint}.set`);
    return normalizeBufferBinding(binding, {
      resourceLabel: value.buffer.options.label ?? value.buffer.gpu.label,
      resource: { buffer: value.gpu, offset: 0, size: value.size },
      identity: value.buffer.resourceIdentity,
      tracked: [trackedResource(value.buffer, value.buffer.resourceIdentity)]
    }, context);
  }
  if (isGPUBufferBinding(value))
    return normalizeBufferBinding(binding, { resource: value, identity: syntheticIdentity(value.buffer) }, context);
  if (isRawGPUBuffer(value))
    return normalizeBufferBinding(binding, { resource: { buffer: value }, identity: syntheticIdentity(value) }, context);
  throw incompatibleResourceError(binding, "buffer", `Pass a compatible Buffer/Uniform: ${binding.name}.set({ ${binding.name}: gpu.device.createBuffer(...) }).`);
}
function normalizeBufferBinding(binding, normalized, context) {
  if (!isGPUBufferBinding(normalized.resource))
    return normalized;
  const { buffer } = normalized.resource;
  const offset = normalized.resource.offset === void 0 ? 0 : normalized.resource.offset;
  const size = normalized.resource.size === void 0 ? buffer.size - offset : normalized.resource.size;
  validateBufferRange(binding, buffer, offset, size, context.device.limits, normalized.tracked !== void 0);
  return {
    ...normalized,
    resource: { buffer, offset, size },
    identity: bufferRangeIdentity(buffer, offset, size),
    underlyingBuffer: buffer
  };
}
function validateBufferRange(binding, buffer, offset, size, limits, tracked) {
  const layout = binding.bindingLayout?.kind === "buffer" ? binding.bindingLayout.buffer : void 0;
  const storage2 = layout?.type === "storage" || layout?.type === "read-only-storage";
  const usageName = storage2 ? "storage" : "uniform";
  const usageFlag2 = globalThis.GPUBufferUsage?.[storage2 ? "STORAGE" : "UNIFORM"] ?? (storage2 ? 128 : 64);
  const alignment = storage2 ? limits.minStorageBufferOffsetAlignment : limits.minUniformBufferOffsetAlignment;
  const maximum = storage2 ? limits.maxStorageBufferBindingSize : limits.maxUniformBufferBindingSize;
  const minimum = Math.max(layout?.minBindingSize ?? 0, binding.layout?.size ?? 0);
  const fix = `Create the buffer with ${usageName} usage and use a safe integer offset aligned to ${alignment} bytes plus a positive size from ${Math.max(1, minimum)} to ${maximum} bytes within buffer.size.`;
  const reject = (reason) => {
    throw incompatibleResourceError(binding, `a valid ${usageName} buffer range (${reason})`, fix);
  };
  if ((buffer.usage & usageFlag2) === 0) {
    const usageFix = tracked ? `Create with usage: ['${usageName}','copy_dst'].` : fix;
    throw incompatibleResourceError(binding, `a valid ${usageName} buffer range (buffer usage is missing ${usageName})`, usageFix);
  }
  if (!Number.isFinite(offset) || !Number.isSafeInteger(offset) || offset < 0)
    reject("offset must be a non-negative safe integer");
  if (!Number.isFinite(size) || !Number.isSafeInteger(size) || size <= 0)
    reject("size must be a positive safe integer");
  if (offset > buffer.size)
    reject("offset exceeds buffer.size");
  if (size > buffer.size - offset)
    reject("offset + size exceeds buffer.size");
  if (offset % alignment !== 0)
    reject(`offset must be aligned to ${alignment} bytes`);
  if (size < minimum)
    reject(`size is below the reflected minimum of ${minimum} bytes`);
  if (size > maximum)
    reject(`size exceeds the granted maximum of ${maximum} bytes`);
  if (storage2 && size % 4 !== 0)
    reject("storage size must be a multiple of 4 bytes");
}
function bufferRangeIdentity(buffer, offset, size) {
  return `buffer-range:${JSON.stringify([identityKey(syntheticIdentity(buffer)), offset, size])}`;
}
function normalizeTextureResource(binding, value, context) {
  const depthBinding = binding.bindingLayout?.kind === "texture" && binding.bindingLayout.texture.sampleType === "depth";
  const target2 = asTarget(value);
  if (target2) {
    if (depthBinding && !target2.depth)
      throw incompatibleResourceError(binding, "a target with a depth attachment", `Create it with target(gpu, { size, depth: true }) or bind a Texture: set({ ${binding.name}: scene.depth }).`);
    const texture = depthBinding ? target2.depth : target2.color;
    validateTextureFilterability(binding, texture, context);
    const bound = bindingTextureView(texture, textureViewDescriptor(texture), context.cache, context.device);
    return {
      resourceLabel: texture.label,
      resource: bound.view,
      identity: texture.resourceIdentity,
      cacheIdentity: textureViewIdentity(texture.resourceIdentity, bound.key),
      tracked: [trackedResource(target2, target2.resourceIdentity), trackedResource(texture, texture.resourceIdentity)],
      followedTarget: { target: target2, depth: depthBinding }
    };
  }
  if (value instanceof Texture) {
    validateTextureUsage(binding, value.usage);
    validateTextureFilterability(binding, value, context);
    const bound = bindingTextureView(value, textureViewDescriptor(value), context.cache, context.device);
    return { resourceLabel: value.label, resource: bound.view, identity: value.resourceIdentity, cacheIdentity: textureViewIdentity(value.resourceIdentity, bound.key), tracked: [trackedResource(value, value.resourceIdentity)] };
  }
  if (isTextureLike(value))
    return { resource: value.createView(), identity: value.resourceIdentity ?? syntheticIdentity(value) };
  if (typeof value === "object" && value !== null)
    return { resource: value, identity: syntheticIdentity(value) };
  throw incompatibleResourceError(binding, "texture/target", `Pass a Texture or Target: ${binding.name}.set({ ${binding.name}: scene.color }) or set({ ${binding.name}: scene }).`);
}
function normalizeStorageTextureResource(binding, value, context) {
  const layout = binding.bindingLayout?.kind === "storageTexture" ? binding.bindingLayout.storageTexture : void 0;
  const expected = { format: layout?.format, viewDimension: layout?.viewDimension ?? "2d" };
  const create = `texture(gpu, { kind: "${expected.viewDimension}", size${expected.viewDimension === "2d-array" ? ", layers" : ""}, format: "${expected.format ?? "rgba8unorm"}", usage: ["storage_binding"] })`;
  if (asTarget(value))
    throw incompatibleResourceError(binding, "a storage texture, not a Target", `Render targets are not storage textures. Create one with ${create} and set({ ${binding.name}: texture }).`);
  if (value instanceof Texture) {
    validateStorageTexture(binding, value, expected, create);
    const bound = bindingTextureView(value, storageViewDescriptor(expected.viewDimension), context.cache, context.device);
    return { resourceLabel: value.label, resource: bound.view, identity: value.resourceIdentity, cacheIdentity: textureViewIdentity(value.resourceIdentity, bound.key), tracked: [trackedResource(value, value.resourceIdentity)] };
  }
  if (isTextureLike(value))
    return { resource: value.createView(storageViewDescriptor(expected.viewDimension)), identity: value.resourceIdentity ?? syntheticIdentity(value) };
  if (typeof value === "object" && value !== null)
    return { resource: value, identity: syntheticIdentity(value) };
  throw incompatibleResourceError(binding, "a storage texture", `Pass a Texture from ${create}: set({ ${binding.name}: texture }).`);
}
function validateStorageTexture(binding, texture, expected, create) {
  const name = texture.label ?? "texture";
  if (!texture.usage.includes("storage_binding"))
    throw incompatibleResourceError(binding, "a texture with storage_binding usage", `Create it with ${create}; include texture_binding too if you also sample it.`);
  if (expected.format && texture.format !== expected.format) {
    throw incompatibleResourceError(binding, `format ${expected.format}`, `Texture '${name}' is ${texture.format}. Create it with ${create} or declare texture_storage_${expected.viewDimension.replace("-", "_")}<${texture.format}, ...> in WGSL.`);
  }
  const dimension = textureDimensionFor(expected.viewDimension);
  if (dimension && texture.dimension !== dimension)
    throw incompatibleResourceError(binding, `dimension "${dimension}"`, `Texture '${name}' has kind "${texture.kind}". Create it with ${create}.`);
}
function storageViewDescriptor(dimension) {
  return { dimension, baseMipLevel: 0, mipLevelCount: 1 };
}
function textureDimensionFor(viewDimension) {
  switch (viewDimension) {
    case "1d":
      return "1d";
    case "2d":
    case "2d-array":
      return "2d";
    case "3d":
      return "3d";
    default:
      return void 0;
  }
}
function normalizeSamplerResource(binding, value) {
  if (isSamplerLike(value))
    return { resource: value, identity: syntheticIdentity(value) };
  throw incompatibleResourceError(binding, "sampler", `Use the cached sampler: set({ ${binding.name}: sampler(gpu) }).`);
}
function isSamplerLike(value) {
  if (typeof value !== "object" || value === null)
    return false;
  if (value instanceof Buffer || value instanceof Texture)
    return false;
  return !isRawGPUBuffer(value) && !isGPUBufferBinding(value) && !isTextureLike(value) && !asTarget(value);
}
function validateTextureUsage(binding, usage) {
  if (!usage.includes("texture_binding") && !usage.includes("render_attachment")) {
    throw incompatibleResourceError(binding, "sampled texture", "Use texture_binding usage or a sampleable Target.");
  }
}
function validateTextureFilterability(binding, texture, context) {
  if (!context.filterableTexture || context.float32Filterable)
    return;
  if (texture.format === "r32float" || texture.format === "rg32float" || texture.format === "rgba32float") {
    throw textureFilterabilityError(context.sourceHint, binding, texture.format, texture.label ?? "texture", context.pairedSampler);
  }
}
function textureViewDescriptor(texture) {
  return texture.format.includes("stencil") ? { aspect: "depth-only" } : void 0;
}
function trackedResource(resource, identity) {
  return { resource, identity, subscribe: (callback) => resource.onDestroy(callback) };
}
function trackedBufferLabel(value) {
  try {
    const buffer = value instanceof Buffer ? value : typeof value === "object" && value !== null && "buffer" in value ? value.buffer : void 0;
    return buffer instanceof Buffer ? buffer.options.label ?? buffer.gpu.label : void 0;
  } catch {
    return void 0;
  }
}
function asTarget(value) {
  if (typeof value !== "object" || value === null)
    return void 0;
  const record = value;
  if (!record.resourceIdentity || !record.color || typeof record.onDestroy !== "function")
    return void 0;
  return record;
}
function hasAnyResourceShape(value) {
  const record = value;
  return "gpu" in record || "bindGroup" in record || "createView" in record || "resourceIdentity" in record;
}
function syntheticIdentity(value) {
  if (typeof value !== "object" || value === null)
    return `value:${String(value)}`;
  let id = syntheticIds.get(value);
  if (!id) {
    id = { kind: "external", id: nextSyntheticResourceId++ };
    syntheticIds.set(value, id);
  }
  return id;
}
function textureViewIdentity(identity, key) {
  return `texture-view:${JSON.stringify([identityKey(identity), key])}`;
}
function isUniformLike(value) {
  return typeof value === "object" && value !== null && "gpu" in value && "size" in value && "buffer" in value && value.buffer instanceof Buffer;
}
function isTextureLike(value) {
  return typeof value === "object" && value !== null && typeof value.createView === "function";
}
function isGPUBufferBinding(value) {
  return typeof value === "object" && value !== null && "buffer" in value && isRawGPUBuffer(value.buffer);
}
function isRawGPUBuffer(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const candidate = value;
  return Number.isSafeInteger(candidate.size) && candidate.size >= 0 && typeof candidate.usage === "number" && typeof candidate.destroy === "function" && typeof candidate.mapAsync === "function" && typeof candidate.getMappedRange === "function" && typeof candidate.unmap === "function";
}

// node_modules/vgpu/dist/bytes-equal.js
function bytesEqual(a, b) {
  const x = a instanceof Uint8Array ? a : new Uint8Array(a);
  const y = b instanceof Uint8Array ? b : new Uint8Array(b);
  if (x.byteLength !== y.byteLength)
    return false;
  for (let i = 0; i < x.byteLength; i++)
    if (x[i] !== y[i])
      return false;
  return true;
}

// node_modules/vgpu/dist/set-packing.js
function writeLayoutValue(layout, value) {
  ensureStaticLayoutSize(layout);
  validateValue(layout, value, "$", 0, layout.size);
  const bytes = new ArrayBuffer(layout.size);
  writeValue(new DataView(bytes), layout, 0, value);
  return bytes;
}
function ensureStaticLayoutSize(layout) {
  if (layout.size === void 0)
    throw unsupportedError("set", `No se puede inferir byteLength para layout runtime-sized '${layout.name}'.`);
}
function writeValue(view, layout, offset, value) {
  if (layout.members)
    return writeStruct(view, layout.members, offset, value);
  writeLeafValue(view, layout, offset, value);
}
function writeStruct(view, members, base, value) {
  const object = value;
  for (const member of members)
    writeValue(view, member.layout, base + member.offset, object?.[member.name]);
}
function writeLeafValue(view, layout, offset, value) {
  switch (layout.type.kind) {
    case "scalar":
      return writeScalar(view, offset, layout.type.name, value);
    case "atomic":
      return writeAtomic(view, offset, layout.type, value);
    case "vector":
      return writeVector(view, offset, layout.type, value);
    case "matrix":
      return writeMatrix(view, layout, offset, value);
    case "array":
      return writeArray(view, layout, offset, value);
    default:
      throw unsupportedError("set", `No hay writer para layout ${layout.type.kind}.`);
  }
}
function writeScalar(view, offset, type, value) {
  if (type === "f32")
    view.setFloat32(offset, value, true);
  else if (type === "i32")
    view.setInt32(offset, value, true);
  else if (type === "u32" || type === "bool")
    view.setUint32(offset, type === "bool" ? value ? 1 : 0 : value, true);
  else
    view.setUint16(offset, float32ToFloat16(value), true);
}
function writeAtomic(view, offset, type, value) {
  writeScalar(view, offset, scalarName(type.element), value);
}
function writeVector(view, offset, type, value) {
  const values = value;
  const stride = scalarByteSize(type.element);
  for (let i = 0; i < type.width; i++)
    writeScalar(view, offset + i * stride, scalarName(type.element), values?.[i] ?? 0);
}
function writeMatrix(view, layout, offset, value) {
  const matrix = layout.type;
  const values = value;
  const scalar = scalarByteSize(matrix.element);
  const stride = layout.stride ?? 16;
  for (let c = 0; c < matrix.columns; c++)
    for (let r = 0; r < matrix.rows; r++)
      writeScalar(view, offset + c * stride + r * scalar, scalarName(matrix.element), values?.[c * matrix.rows + r] ?? 0);
}
function writeArray(view, layout, offset, value) {
  const values = value;
  const stride = layout.stride ?? layout.element?.size ?? 0;
  if (!layout.element)
    throw unsupportedError("set", "Array layout sin element layout.");
  for (let i = 0; i < values.length; i++)
    writeValue(view, layout.element, offset + i * stride, values[i]);
}
function validateValue(layout, value, path, offset, byteLength) {
  if (layout.members) {
    validateStruct(layout.members, value, path, offset, byteLength);
    return;
  }
  switch (layout.type.kind) {
    case "scalar":
      validateScalar(layout.type.name, value, path);
      validateRange(path, offset, scalarByteSize(layout.type), byteLength);
      return;
    case "atomic":
      validateScalar(scalarName(layout.type.element), value, path);
      validateRange(path, offset, 4, byteLength);
      return;
    case "vector":
      validateVector(layout.type, value, path, offset, byteLength);
      return;
    case "matrix":
      validateMatrix(layout, value, path, offset, byteLength);
      return;
    case "array":
      validateArray(layout, value, path, offset, byteLength);
      return;
    default:
      throw unsupportedError("set", `No hay validator para layout ${layout.type.kind}.`);
  }
}
function validateStruct(members, value, path, base, byteLength) {
  if (!isPlainRecord(value))
    throwPacking("type", path, "an object", valueKind(value));
  const declared = new Set(members.map((member) => member.name));
  const unknown = Object.keys(value).find((name) => !declared.has(name));
  if (unknown !== void 0)
    throwPacking("unknown-field", `${path}.${unknown}`, "a declared field", unknown);
  for (const member of members) {
    const memberPath = `${path}.${member.name}`;
    if (!Object.hasOwn(value, member.name))
      throwPacking("missing-field", memberPath, "a required field", "missing");
    validateValue(member.layout, value[member.name], memberPath, base + member.offset, byteLength);
  }
}
function validateVector(type, value, path, offset, byteLength) {
  const values = exactArrayLike(value, path, type.width);
  const scalar = scalarName(type.element);
  const stride = scalarByteSize(type.element);
  for (let index = 0; index < type.width; index++) {
    validateScalar(scalar, values[index], `${path}[${index}]`);
    validateRange(`${path}[${index}]`, offset + index * stride, stride, byteLength);
  }
}
function validateMatrix(layout, value, path, offset, byteLength) {
  const matrix = layout.type;
  const expected = matrix.columns * matrix.rows;
  const values = exactArrayLike(value, path, expected);
  const scalar = scalarName(matrix.element);
  const scalarSize = scalarByteSize(matrix.element);
  const stride = layout.stride;
  if (stride === void 0)
    throw unsupportedError("set", `Matrix layout '${layout.name}' sin stride.`);
  for (let column = 0; column < matrix.columns; column++) {
    for (let row = 0; row < matrix.rows; row++) {
      const index = column * matrix.rows + row;
      const elementPath = `${path}[${column}][${row}]`;
      validateScalar(scalar, values[index], elementPath);
      validateRange(elementPath, offset + column * stride + row * scalarSize, scalarSize, byteLength);
    }
  }
}
function validateArray(layout, value, path, offset, byteLength) {
  const values = arrayLike(value, path);
  const arrayType = layout.type;
  if (arrayType.count !== void 0 && values.length !== arrayType.count) {
    throwPacking("shape", path, arrayType.count, values.length);
  }
  const stride = layout.stride;
  if (stride === void 0 || !layout.element)
    throw unsupportedError("set", `Array layout '${layout.name}' sin stride o element layout.`);
  if (layout.runtimeSized) {
    const expected = checkedExtent(stride, values.length, path);
    const actual = layout.size ?? byteLength - offset;
    if (actual !== expected)
      throwPacking("extent", path, expected, actual);
  }
  for (let index = 0; index < values.length; index++) {
    validateValue(layout.element, values[index], `${path}[${index}]`, offset + index * stride, byteLength);
  }
}
function validateScalar(type, value, path) {
  if (type === "bool") {
    if (typeof value !== "boolean")
      throwPacking("type", path, "bool", valueKind(value), type);
    return;
  }
  if (typeof value !== "number")
    throwPacking("type", path, type, valueKind(value), type);
  if (type === "i32" && (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)) {
    throwPacking("integer-range", path, "an integer in [-2147483648, 2147483647]", String(value), type);
  }
  if (type === "u32" && (!Number.isInteger(value) || value < 0 || value > 4294967295)) {
    throwPacking("integer-range", path, "an integer in [0, 4294967295]", String(value), type);
  }
}
function exactArrayLike(value, path, expected) {
  const values = arrayLike(value, path);
  if (values.length !== expected)
    throwPacking("shape", path, expected, values.length);
  return values;
}
function arrayLike(value, path) {
  if (Array.isArray(value))
    return value;
  if (ArrayBuffer.isView(value) && !(value instanceof DataView) && "length" in value) {
    return value;
  }
  throwPacking("type", path, "an array or typed array", valueKind(value));
}
function validateRange(path, offset, size, byteLength) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset > byteLength - size) {
    throwPacking("buffer-range", path, `${size} bytes inside ${byteLength}`, offset);
  }
}
function checkedExtent(stride, count, path) {
  const extent = stride * count;
  if (!Number.isSafeInteger(stride) || stride < 0 || !Number.isSafeInteger(extent)) {
    throwPacking("extent", path, "a safe byte extent", String(extent));
  }
  return extent;
}
function throwPacking(reason, path, expected, actual, type) {
  const message = reason === "shape" ? `expected exactly ${expected} values, received ${actual}` : reason === "missing-field" ? "required field is missing" : reason === "unknown-field" ? `field '${actual}' is not declared by the layout` : reason === "integer-range" ? `${actual} is outside the exact ${type} range` : reason === "extent" ? `runtime extent requires ${expected} bytes, received ${actual}` : reason === "buffer-range" ? `write at byte ${actual} exceeds ${expected}` : `expected ${expected}, received ${actual}`;
  const detail = type === void 0 ? { reason, path, expected, actual } : { reason, path, expected, actual, type };
  throw setValueInvalidError(detail, message);
}
function isPlainRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value) || ArrayBuffer.isView(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function valueKind(value) {
  if (value === null)
    return "null";
  if (Array.isArray(value))
    return "array";
  if (ArrayBuffer.isView(value))
    return value.constructor.name;
  return typeof value;
}
function scalarByteSize(type) {
  return scalarName(type) === "f16" ? 2 : 4;
}
function scalarName(type) {
  if (type.kind !== "scalar")
    throw unsupportedError("set", `Expected scalar, got ${type.kind}`);
  return type.name;
}
function float32ToFloat16(value) {
  const float = new Float32Array(1), int = new Uint32Array(float.buffer);
  float[0] = value;
  const x = int[0];
  const sign = x >> 16 & 32768, mantissa = x & 8388607, exponent = x >> 23 & 255;
  if (exponent === 255)
    return sign | (mantissa ? 32256 : 31744);
  const halfExponent = exponent - 127 + 15;
  if (halfExponent >= 31)
    return sign | 31744;
  if (halfExponent <= 0) {
    if (halfExponent < -10)
      return sign;
    return sign | roundRightToNearestEven(mantissa | 8388608, 14 - halfExponent);
  }
  const roundedMantissa = roundRightToNearestEven(mantissa, 13);
  if (roundedMantissa === 1024) {
    const roundedExponent = halfExponent + 1;
    return roundedExponent >= 31 ? sign | 31744 : sign | roundedExponent << 10;
  }
  return sign | halfExponent << 10 | roundedMantissa;
}
function roundRightToNearestEven(value, shift) {
  const truncated = value >>> shift;
  const remainderMask = (1 << shift) - 1;
  const remainder = value & remainderMask;
  const halfway = 1 << shift - 1;
  return remainder > halfway || remainder === halfway && (truncated & 1) === 1 ? truncated + 1 : truncated;
}

// node_modules/vgpu/dist/native-validation.js
function nativeScope(device, operation) {
  const gpu = device.gpu;
  const scoped = typeof gpu.pushErrorScope === "function" && typeof gpu.popErrorScope === "function";
  if (scoped)
    gpu.pushErrorScope("validation");
  let active2 = scoped;
  const pop = () => {
    if (!active2)
      return Promise.resolve(null);
    active2 = false;
    try {
      return gpu.popErrorScope().then((error) => error, (cause) => cause);
    } catch (cause) {
      return Promise.resolve(cause);
    }
  };
  try {
    const value = operation();
    return { value, error: pop() };
  } catch (cause) {
    void pop();
    throw cause;
  }
}
var validations = /* @__PURE__ */ new WeakMap();
function nativeObject(device, create, dependencies = []) {
  let captured;
  try {
    captured = nativeScope(device, create);
  } catch (cause) {
    throw cause instanceof VGPUError2 ? cause : compileFailedError("pipeline.setup", cause);
  }
  const { value, error } = captured;
  validations.set(value, { error: Promise.all([objectValidation(dependencies), error]).then((errors) => errors.find(Boolean) ?? null), claimed: false });
  return value;
}
function objectValidation(objects) {
  return Promise.all(objects.map((object) => {
    const validation = validations.get(object);
    if (validation)
      validation.claimed = true;
    return validation?.error;
  })).then((errors) => errors.find(Boolean) ?? null);
}
async function deliverObjectValidation(object, where, sink) {
  const validation = validations.get(object);
  const cause = await validation?.error;
  if (cause && !validation?.claimed)
    await sink(compileFailedError(where, cause));
}
function validateOperation(device, results, where, operation, origin) {
  try {
    const { value, error } = nativeScope(device, operation);
    results.push({ error, where, origin });
    return value;
  } catch (cause) {
    if (cause instanceof VGPUError2)
      throw cause;
    throw operationError(where, cause);
  }
}
function operationError(where, cause) {
  return new VGPUError2({ code: "VGPU-COMPUTE-VALIDATION", message: "WebGPU compute operation failed validation.", where, cause, fix: "Check pipeline compilation, resource compatibility, dispatch counts, and device limits." });
}
async function deliverOperations(results, sink) {
  const origins = await Promise.all(results.map((result) => result.origin?.()));
  let reported = false;
  for (const [index, result] of results.entries()) {
    const error = await result.error;
    if (origins[index]) {
      reported = true;
      continue;
    }
    if (!error)
      continue;
    if (!reported || result.origin) {
      await sink(operationError(result.where, error));
      reported = true;
    }
  }
}

// node_modules/vgpu/dist/set-layouts.js
var bindGroupLayoutCaches = /* @__PURE__ */ new WeakMap();
function visibilityForEntries(bindings, entries) {
  const masks = /* @__PURE__ */ new Map();
  const filterable = /* @__PURE__ */ new Set();
  const nonFilteringSamplers = /* @__PURE__ */ new Set();
  const depthTextures = new Set(bindings.filter((binding) => binding.bindingLayout?.kind === "texture" && binding.bindingLayout.texture.sampleType === "depth").map((binding) => `${binding.group}:${binding.binding}`));
  for (const entry of entries) {
    const stage = entry.stage === "vertex" ? 1 : entry.stage === "fragment" ? 2 : 4;
    for (const binding of entryMetadata(entry, "bindings", "visibility")) {
      const key = `${binding.group}:${binding.binding}`;
      masks.set(key, (masks.get(key) ?? 0) | stage);
    }
    for (const pair of entryMetadata(entry, "samplingPairs", "visibility")) {
      if (pair.mode !== "filtering")
        continue;
      const textureKey = `${pair.texture.group}:${pair.texture.binding}`;
      if (depthTextures.has(textureKey))
        nonFilteringSamplers.add(`${pair.sampler.group}:${pair.sampler.binding}`);
      else
        filterable.add(textureKey);
    }
  }
  const policy = (binding) => masks.get(`${binding.group}:${binding.binding}`) ?? 0;
  Object.defineProperty(policy, "filterable", { value: filterable });
  Object.defineProperty(policy, "nonFilteringSamplers", { value: nonFilteringSamplers });
  return policy;
}
function bindGroupLayoutEntriesForGroup(bindings, group, visibility = defaultVisibility) {
  return bindings.flatMap((binding) => {
    if (binding.group !== group)
      return [];
    const mask = visibility(binding);
    const key = `${binding.group}:${binding.binding}`;
    return mask === 0 ? [] : [{ binding: binding.binding, visibility: mask, ...layoutEntry(binding, visibility.filterable?.has(key) ?? false, visibility.nonFilteringSamplers?.has(key) ?? false) }];
  });
}
function bindGroupLayoutsForReflection(device, label, reflection, visibility = defaultVisibility) {
  const map = /* @__PURE__ */ new Map();
  const activeGroups = reflection.bindings.filter((binding) => visibility(binding) !== 0).map((binding) => binding.group);
  const maxGroup = Math.max(-1, ...activeGroups);
  for (let group = 0; group <= maxGroup; group++)
    map.set(group, createBindGroupLayout(device, label, reflection, group, visibility));
  return map;
}
function createBindGroupLayout(device, label, reflection, group, visibility = defaultVisibility) {
  return cachedBindGroupLayout(device, `${label}.group${group}.bgl`, bindGroupLayoutEntriesForGroup(reflection.bindings, group, visibility));
}
function cachedBindGroupLayout(device, label, entries) {
  let cache = bindGroupLayoutCaches.get(device.gpu);
  if (!cache) {
    cache = /* @__PURE__ */ new Map();
    bindGroupLayoutCaches.set(device.gpu, cache);
  }
  const key = JSON.stringify(entries);
  const cached = cache.get(key);
  if (cached)
    return cached;
  const layout = attachBindGroupLayoutMetadata(nativeObject(device, () => device.gpu.createBindGroupLayout({ label, entries })), { entries });
  cache.set(key, layout);
  return layout;
}
function layoutEntry(binding, filterable, nonFilteringSampler) {
  const reflected = binding.bindingLayout;
  if (!reflected)
    throw unsupportedError("bindGroupLayout", `Binding '${binding.name}' does not have a reflected bindingLayout.`);
  if (filterable && reflected.kind === "texture" && reflected.texture.sampleType === "unfilterable-float" && !reflected.texture.multisampled)
    return { texture: { ...reflected.texture, sampleType: "float" } };
  if (nonFilteringSampler && reflected.kind === "sampler" && reflected.sampler.type === "filtering")
    return { sampler: { type: "non-filtering" } };
  return reflectedToWebGPU(reflected);
}
function reflectedToWebGPU(layout) {
  switch (layout.kind) {
    case "buffer":
      return { buffer: { ...layout.buffer } };
    case "sampler":
      return { sampler: { ...layout.sampler } };
    case "texture":
      return { texture: { ...layout.texture } };
    case "storageTexture":
      return { storageTexture: { ...layout.storageTexture } };
    case "externalTexture":
      return { externalTexture: {} };
  }
}
function defaultVisibility(binding) {
  const stages = globalThis.GPUShaderStage;
  const vertex = stages?.VERTEX ?? 1;
  const fragment = stages?.FRAGMENT ?? 2;
  const compute = stages?.COMPUTE ?? 4;
  return binding.kind === "buffer" ? vertex | fragment | compute : fragment | compute;
}

// node_modules/vgpu/dist/set-core.js
var EMPTY = Object.freeze([]);
var setCoreTestStates = /* @__PURE__ */ new WeakMap();
var noCleanupFailure = /* @__PURE__ */ Symbol("no cleanup failure");
function createSetCore(options) {
  let liveOptions = options;
  const label = options.label;
  const disposedError = options.disposedError;
  const bindings = initializeBindings(options.reflection);
  const groups = [...options.bindGroupLayouts.keys()].sort((a, b) => a - b);
  const claimedGroups = /* @__PURE__ */ new Map();
  const cacheOwner = {};
  const activeByGroup = /* @__PURE__ */ new Map();
  const stats = { fullVerifications: 0, groupPlanBuilds: 0 };
  let verified = -1;
  let followed = [];
  const plans = /* @__PURE__ */ new Map();
  refreshLayouts();
  function changed() {
    verified = -1;
    plans.clear();
  }
  function current(operation) {
    if (!liveOptions)
      throw disposedError(operation);
    return liveOptions;
  }
  function set(values) {
    current("set");
    const changes = [];
    for (const [name, value] of Object.entries(values))
      changes.push(...setNamedValue(name, value));
    return changes;
  }
  function bindingIsActive(state) {
    return activeByGroup.get(state.info.group)?.active.has(state.info.binding) ?? false;
  }
  function refreshLayouts() {
    const options2 = current("layout");
    for (const [group, layout2] of options2.bindGroupLayouts) {
      const previous = activeByGroup.get(group);
      if (previous?.layout === layout2)
        continue;
      if (previous) {
        options2.cache.clearOwner(cacheOwner, group);
        changed();
      }
      const active2 = new Set(bindGroupLayoutMetadata(layout2)?.entries.map((entry) => entry.binding) ?? []);
      const bindings2 = options2.reflection.bindings.filter((binding) => binding.group === group && active2.has(binding.binding));
      activeByGroup.set(group, { layout: layout2, active: active2, bindings: bindings2 });
    }
  }
  function setNamedValue(name, value) {
    const direct = bindings.get(name);
    if (direct)
      return setBinding(direct, name, value);
    const member = findMemberBinding(name, bindings, label);
    if (!member)
      throw unsupportedError(`${label}.set`, `Binding '${name}' does not exist in '${label}'.`);
    return setBindingMember(member, name, value);
  }
  function setBinding(state, name, value) {
    assertResourceBindable(state.info, value, label);
    ensureGroupSettable(state.info.group);
    const ownership = ownershipFor(state.info, value);
    assertBindingOwnership(state, name, ownership);
    const before = identityString(state.identity);
    if (ownership === "lib")
      setLibOwned(state, mergeLibValue(state.libValue, value));
    else
      setUserOwned(state, value);
    state.ownership ??= ownership;
    return bindingIsActive(state) ? identityChangeFor(state, before) : [];
  }
  function setBindingMember(state, memberName, value) {
    ensureGroupSettable(state.info.group);
    const ownership = ownershipFor(state.info, value);
    assertBindingOwnership(state, memberName, ownership);
    assertMemberOwnership(state, memberName, ownership);
    if (ownership !== "lib")
      throw unsupportedError(`${label}.set`, `Member '${memberName}' needs a JS value; set resource '${state.info.name}' instead.`);
    const before = identityString(state.identity);
    const base = state.libValue ?? zeroLayoutValue(requiredLibLayout(state));
    setLibOwned(state, { ...objectValue(base), [memberName]: value });
    state.ownership ??= ownership;
    state.memberOwnership.set(memberName, ownership);
    return bindingIsActive(state) ? identityChangeFor(state, before) : [];
  }
  function setLibOwned(state, value) {
    const layout2 = requiredLibLayout(state);
    const bytes = writeLayoutValue(layout2, value);
    state.libValue = value;
    if (!state.buffer)
      createLibBuffer(state, layout2.size);
    if (!state.bytes || !bytesEqual(state.bytes, bytes)) {
      state.bytes = bytes;
      state.revision = (state.revision ?? 0) + 1;
      state.dirtyUniform = true;
    }
    if (state.liveUniform || state.info.addressSpace !== "uniform") {
      state.dirtyUniform = true;
      prepareUniform(state, false);
    }
  }
  function prepareUniform(state, retain) {
    state.prepareUniform?.(retain);
    if (state.dirtyUniform) {
      state.buffer.write(state.bytes, 0);
      state.dirtyUniform = false;
    }
    if (retain)
      state.liveUniform = true;
  }
  function resourceContext(binding) {
    const options2 = current("set");
    const entry = bindGroupLayoutMetadata(options2.bindGroupLayouts.get(binding.group))?.entries.find((item) => item.binding === binding.binding);
    const pair = options2.reflection.entryPoints.flatMap((item) => entryMetadata(item, "samplingPairs", label)).find((item) => item.mode === "filtering" && item.texture.group === binding.group && item.texture.binding === binding.binding);
    const pairedSampler = pair && options2.reflection.bindings.find((item) => item.group === pair.sampler.group && item.binding === pair.sampler.binding);
    return { device: options2.device, cache: options2.cache, sourceHint: label, filterableTexture: entry?.texture?.sampleType === "float", float32Filterable: options2.device.features.has("float32-filterable"), pairedSampler };
  }
  function setUserOwned(state, value) {
    const normalized = normalizeResource(state.info, value, resourceContext(state.info));
    commitNormalized(state, value, normalized);
  }
  function commitNormalized(state, value, normalized) {
    const options2 = current("set");
    changed();
    state.resource = normalized.resource;
    state.uniformValue = normalized.uniformValue;
    state.prepareUniform = normalized.prepareUniform;
    state.identity = normalized.identity;
    state.cacheIdentity = normalized.cacheIdentity;
    state.resourceLabel = normalized.resourceLabel;
    state.sourceValue = value;
    state.followedTarget = normalized.followedTarget;
    state.markers = normalized.tracked?.map(({ resource, identity, subscribe }) => options2.cache.marker(resource, identity, subscribe));
    state.dependencies = normalized.tracked?.map(({ identity }) => identity) ?? [];
    state.underlyingBuffer = normalized.underlyingBuffer;
  }
  function claimGroup(group, bindGroup, expectedLayout) {
    layout(group);
    validateClaimedGroup(label, group, bindGroup, expectedLayout);
    const previousIdentity = claimedGroups.has(group) ? `claimed-group:${group}` : void 0;
    claimedGroups.set(group, bindGroup);
    changed();
    return previousIdentity;
  }
  function refreshFollowedTarget(state) {
    const followed2 = state.followedTarget;
    if (!followed2)
      return;
    if (state.markers?.[0]?.destroyed)
      throw destroyedBindingError(label, state.info, state.resourceLabel);
    const selected = followed2.depth ? followed2.target.depth : followed2.target.color;
    if (!selected || identityKey(selected.resourceIdentity) === identityString(state.identity))
      return;
    commitNormalized(state, followed2.target, normalizeResource(state.info, followed2.target, resourceContext(state.info)));
  }
  function assertUsable() {
    current("bindingState");
    const followedStates = [];
    for (const state of bindings.values()) {
      if (!bindingIsActive(state) || claimedGroups.has(state.info.group) || !state.resource)
        continue;
      refreshFollowedTarget(state);
      if (state.followedTarget)
        followedStates.push(state);
      if (state.markers?.some((marker) => marker.destroyed))
        throw destroyedBindingError(label, state.info, state.resourceLabel);
    }
    return followedStates;
  }
  function preflight() {
    const epoch = current("preflight").cache.lifetime.destroyEpoch;
    if (verified === epoch) {
      for (const state of followed)
        refreshFollowedTarget(state);
      if (verified === epoch)
        return;
    }
    stats.fullVerifications++;
    followed = assertUsable();
    for (const state of bindings.values())
      if (bindingIsActive(state) && !claimedGroups.has(state.info.group))
        requiredState(state.info);
    verified = epoch;
  }
  function captureResources() {
    const options2 = current("resourceSnapshots");
    preflight();
    const snapshots = [];
    for (const state of bindings.values()) {
      if (!bindingIsActive(state) || claimedGroups.has(state.info.group))
        continue;
      if (state.info.addressSpace === "uniform")
        prepareUniform(state, true);
      if (!state.markers?.length && !state.followedTarget)
        continue;
      snapshots.push({
        lifetime: options2.cache.lifetime,
        markers: state.markers ?? [],
        group: state.info.group,
        binding: state.info.binding,
        bindingName: state.info.name,
        bindingKind: state.info.kind,
        capturedIdentity: identityString(state.identity),
        resourceLabel: state.resourceLabel,
        followedTarget: state.followedTarget
      });
    }
    return snapshots;
  }
  function layout(group) {
    const options2 = current("layout");
    const bgl = options2.bindGroupLayouts.get(group);
    if (!bgl)
      throw unsupportedError(`${label}.layout`, `@group(${group}) does not exist in '${label}'.`);
    return bgl;
  }
  function bindGroups(capture) {
    current("bindGroups");
    preflight();
    return groups.map((group) => bindGroupFor(group, capture));
  }
  function bindGroupFor(group, capture) {
    const options2 = current("bindGroups");
    const claimed = claimedGroups.get(group);
    if (claimed)
      return { group, bindGroup: claimed, offsets: EMPTY, claimValidation: rawClaimValidation(claimed, group) };
    const cached = plans.get(group);
    if (cached)
      return cached();
    stats.groupPlanBuilds++;
    const groupBindings = activeByGroup.get(group)?.bindings ?? [];
    const resources = [];
    const keys2 = [];
    const dependencies = [];
    let fixed = true;
    for (const binding of groupBindings) {
      const state = requiredState(binding);
      const value = state.uniformValue?.() ?? (state.bytes && binding.addressSpace === "uniform" ? ownedUniformValue(state) : void 0);
      fixed &&= !value && !state.uniformValue && !state.prepareUniform;
      const captured = capture && value ? capture.capture(value, options2.cache) : void 0;
      if (!captured)
        prepareUniform(state, false);
      if (!captured && state.buffer)
        state.mayHaveNativeConsumers = true;
      resources.push(captured?.resource ?? state.resource);
      keys2.push({ binding: binding.binding, key: captured?.identity ?? state.cacheIdentity ?? state.identity });
      if (captured)
        dependencies.push(captured.identity);
      else if (state.dependencies)
        dependencies.push(...state.dependencies);
    }
    const bindGroupLayout = layout(group);
    const factory = () => options2.device.gpu.createBindGroup({
      label: `${label}.group${group}`,
      layout: bindGroupLayout,
      entries: groupBindings.map((binding, index) => ({ binding: binding.binding, resource: resources[index] }))
    });
    const key = bindGroupKeyOf(keys2);
    const plan = () => ({ group, bindGroup: options2.cache.getOrCreate(cacheOwner, group, bindGroupLayout, keys2, dependencies, factory, key), offsets: EMPTY });
    if (fixed)
      plans.set(group, plan);
    return plan();
  }
  function rawClaimValidation(bindGroup, group) {
    return bindGroupMetadataFor(bindGroup) ? void 0 : { label, group };
  }
  function requiredState(binding) {
    const state = bindings.get(binding.name);
    if (!state?.resource || !state.identity)
      throw neverSetError(label, binding);
    return state;
  }
  function ensureGroupSettable(group) {
    if (claimedGroups.has(group))
      throw claimedGroupSetError(label, group);
  }
  function createLibBuffer(state, size) {
    const options2 = current("set");
    changed();
    state.buffer = options2.device.createBuffer({ size, usage: ["uniform", "copy_dst"], label: `${label}.${state.info.name}` });
    state.resource = { buffer: state.buffer.gpu, offset: 0, size };
    state.identity = state.buffer.resourceIdentity;
    state.markers = [options2.cache.marker(state.buffer, state.buffer.resourceIdentity, (callback) => state.buffer.onDestroy(callback))];
    state.dependencies = [state.buffer.resourceIdentity];
    state.underlyingBuffer = state.buffer.gpu;
  }
  function requiredLibLayout(state) {
    if (state.info.kind !== "buffer" || !state.info.layout?.size)
      throw unsupportedError(`${label}.set`, `Binding '${state.info.name}' needs a compatible resource, not JS.`);
    return state.info.layout;
  }
  const core = {
    dispose() {
      const closing = liveOptions;
      if (!closing)
        return;
      liveOptions = void 0;
      setCoreTestStates.set(core, { disposedError });
      let failure = noCleanupFailure;
      try {
        closing.cache.clearOwner(cacheOwner);
      } catch (error) {
        failure = error;
      }
      for (const state of bindings.values()) {
        if (!state.buffer || state.mayHaveNativeConsumers)
          continue;
        try {
          state.buffer.destroy();
        } catch (error) {
          if (failure === noCleanupFailure)
            failure = error;
        }
      }
      bindings.clear();
      claimedGroups.clear();
      activeByGroup.clear();
      plans.clear();
      followed = [];
      if (failure !== noCleanupFailure)
        throw failure;
    },
    assertUsable,
    preflight,
    refreshLayouts,
    captureResources,
    get groups() {
      current("groups");
      return groups;
    },
    set,
    claimGroup,
    layout,
    bindGroups,
    bindingState(name) {
      current("bindingState");
      const state = bindings.get(name);
      if (!state?.ownership || !state.resource || !state.identity)
        return void 0;
      if (state.buffer)
        state.mayHaveNativeConsumers = true;
      return { info: state.info, ownership: state.ownership, resource: state.resource, identity: state.identity, underlyingBuffer: state.underlyingBuffer };
    }
  };
  setCoreTestStates.set(core, { cache: options.cache, owner: cacheOwner, stats });
  return core;
}
function ownedUniformValue(state) {
  const value = state.ownedValue;
  if (value && value.revision === state.revision)
    return value;
  return state.ownedValue = { owner: state.captureToken, revision: state.revision, bytes: new Uint8Array(state.bytes) };
}
function initializeBindings(reflection) {
  return new Map(reflection.bindings.map((binding) => [binding.name, { info: binding, memberOwnership: /* @__PURE__ */ new Map(), captureToken: {} }]));
}
function findMemberBinding(memberName, bindings, label) {
  let match;
  for (const state of bindings.values()) {
    if (!state.info.layout?.members?.some((member) => member.name === memberName))
      continue;
    if (match)
      throw unsupportedError(`${label}.set`, `Binding member '${memberName}' is ambiguous in '${label}'; set the complete binding.`);
    match = state;
  }
  return match;
}
function ownershipFor(binding, value) {
  return binding.bindingLayout?.kind === "buffer" && isPlainValue(value) ? "lib" : "user";
}
function assertBindingOwnership(state, name, ownership) {
  if (state.ownership && state.ownership !== ownership)
    throw ownershipFlipError(name, state.ownership);
}
function assertMemberOwnership(state, memberName, ownership) {
  const previous = state.memberOwnership.get(memberName);
  if (previous && previous !== ownership)
    throw ownershipFlipError(memberName, previous);
}
function validateClaimedGroup(label, group, bindGroup, expectedLayout) {
  const claimedMetadata = bindGroupMetadataFor(bindGroup);
  if (!claimedMetadata)
    return;
  const expectedMetadata = bindGroupLayoutMetadata(expectedLayout);
  if (!expectedMetadata)
    return;
  const reason = layoutMismatchReason(expectedMetadata.entries, claimedMetadata.layout.entries);
  if (reason)
    throw claimedGroupIncompatibleError(label, group, reason);
}
function layoutMismatchReason(expected, claimed) {
  if (expected.length !== claimed.length)
    return `expected ${expected.length} bindings and received ${claimed.length}`;
  const expectedByBinding = entriesByBinding(expected);
  const claimedByBinding = entriesByBinding(claimed);
  for (const [binding, entry] of expectedByBinding) {
    const claimedEntry = claimedByBinding.get(binding);
    if (!claimedEntry)
      return `missing @binding(${binding})`;
    if (entrySignature(entry) !== entrySignature(claimedEntry))
      return `@binding(${binding}) does not match the reflected layout`;
  }
  return void 0;
}
function entriesByBinding(entries) {
  return new Map(entries.map((entry) => [entry.binding, entry]));
}
function entrySignature(entry) {
  return JSON.stringify({
    binding: entry.binding,
    visibility: entry.visibility,
    buffer: entry.buffer,
    sampler: entry.sampler,
    texture: entry.texture,
    storageTexture: entry.storageTexture,
    externalTexture: entry.externalTexture ? {} : void 0
  });
}
function identityChangeFor(state, previousIdentity) {
  const nextIdentity = identityString(state.identity);
  if (!nextIdentity || previousIdentity === nextIdentity)
    return [];
  return [{
    group: state.info.group,
    binding: state.info.binding,
    bindingName: state.info.name,
    bindingKind: state.info.kind,
    previousIdentity,
    newIdentity: nextIdentity
  }];
}
function identityString(identity) {
  return identity === void 0 ? void 0 : identityKey(identity);
}
function mergeLibValue(previous, value) {
  return isPlainObject(previous) && isPlainObject(value) ? { ...previous, ...value } : value;
}
function objectValue(value) {
  return isPlainObject(value) ? value : {};
}
function zeroLayoutValue(layout) {
  if (layout.members)
    return Object.fromEntries(layout.members.map((member) => [member.name, zeroLayoutValue(member.layout)]));
  switch (layout.type.kind) {
    case "scalar":
    case "atomic":
      return 0;
    case "vector":
      return Array.from({ length: layout.type.width }, () => 0);
    case "matrix":
      return Array.from({ length: layout.type.columns * layout.type.rows }, () => 0);
    case "array": {
      const element = layout.element;
      if (layout.type.count === void 0 || !element)
        return [];
      return Array.from({ length: layout.type.count }, () => zeroLayoutValue(element));
    }
    default:
      return void 0;
  }
}

// node_modules/vgpu/dist/target-utils.js
var DEFAULT_FORMAT = "rgba8unorm";
var BUILT_IN_CLEAR_COLOR = Object.freeze([0, 0, 0, 1]);
function validateClearColor(value, where) {
  const object = value;
  const components = Array.isArray(value) ? value : [object?.r, object?.g, object?.b, object?.a];
  if (components.length !== 4 || !components.every((component) => typeof component === "number" && Number.isFinite(component)))
    throw clearColorInvalidError(where);
  return copyClearColor(value);
}
function copyClearColor(value) {
  const object = value;
  return Array.isArray(value) ? [value[0], value[1], value[2], value[3]] : { r: object.r, g: object.g, b: object.b, a: object.a };
}
function colorSpecsFor(options) {
  return options.colors ?? [{ format: options.format ?? DEFAULT_FORMAT }];
}
function depthFormatFor(options) {
  return options.depth === true ? "depth24plus" : options.depth || void 0;
}
function sampleCountFor(options) {
  const msaa = options.msaa;
  if (msaa === true || msaa === 4)
    return 4;
  if (msaa === void 0 || msaa === false)
    return 1;
  const e = targetSizeRequiredError();
  e.code = "VGPU-TARGET-MSAA-INVALID";
  e.message = `msaa received ${msaa}; WebGPU 1|4; use true`;
  throw e;
}
function validateTargetOptions(options, caps) {
  if (!Array.isArray(options?.size) || options.size.length !== 2 || !Array.from(options.size).every((value) => Number.isSafeInteger(value) && value > 0))
    throw targetSizeRequiredError();
  const depthFormat = depthFormatFor(options);
  if (depthFormat === "stencil8")
    throw targetStencilOnlyDepthError(depthFormat);
  if (sampleCountFor(options) !== 4)
    return;
  for (const spec of colorSpecsFor(options))
    validateMsaaFormat(spec.format, caps);
}
function validateMsaaFormat(format, caps) {
  if (!(caps.isCompatibilityMode && format === "rgba16float"))
    return;
  throw unsupportedError("target", "Dawn compatibility mode does not support rgba16float+msaa.", "Use rgba8unorm for MSAA here, or disable msaa.");
}
function colorAttachment(resolved, msaa, clear, preserve) {
  const attachment = {
    view: (msaa ?? resolved).createView(),
    resolveTarget: msaa ? resolved.createView() : void 0,
    loadOp: preserve ? "load" : "clear",
    storeOp: msaa ? "discard" : "store"
  };
  if (!preserve)
    attachment.clearValue = colorValue(clear);
  return attachment;
}
function depthAttachment(depth, preserve, clearDepth, clearStencil, readOnly) {
  if (readOnly) {
    const attachment2 = { view: depth.createView(), depthReadOnly: true };
    if (hasStencilAspect(depth.format))
      attachment2.stencilReadOnly = true;
    return attachment2;
  }
  const attachment = { view: depth.createView(), depthLoadOp: preserve ? "load" : "clear", depthStoreOp: depth.sampleCount > 1 ? "discard" : "store" };
  if (!preserve)
    attachment.depthClearValue = clearDepth ?? 1;
  if (depth.format && hasStencilAspect(depth.format)) {
    attachment.stencilLoadOp = preserve ? "load" : "clear";
    attachment.stencilStoreOp = depth.sampleCount > 1 ? "discard" : "store";
    if (!preserve)
      attachment.stencilClearValue = clearStencil ?? 0;
  }
  return attachment;
}
function hasStencilAspect(format) {
  return !!format && format.includes("stencil");
}
function colorValue(clear) {
  return Array.isArray(clear) ? { r: clear[0], g: clear[1], b: clear[2], a: clear[3] } : clear;
}
function sameSize(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}
function isTarget(value) {
  return typeof value === "object" && value !== null && typeof value.renderPassDescriptor === "function";
}

// node_modules/vgpu/dist/pipeline-store.js
var nextShaderModuleId = 1;
var nextPipelineLayoutId = 1;
var shaderModuleIds = /* @__PURE__ */ new WeakMap();
var pipelineLayoutIds = /* @__PURE__ */ new WeakMap();
function normalizeSignature(arg) {
  const configured = targetSignatureOf(arg);
  if (configured) {
    return {
      colors: [...configured.colors],
      depth: configured.depth,
      sampleCount: configured.sampleCount ?? 1
    };
  }
  if (isTarget(arg)) {
    return {
      colors: arg.colors.map((color) => color.format),
      depth: arg.depth?.format,
      sampleCount: arg.sampleCount
    };
  }
  if (typeof arg !== "object" || arg === null)
    return { colors: [] };
  return {
    colors: Array.isArray(arg.colors) ? [...arg.colors] : arg.colors ?? [],
    depth: arg.depth,
    sampleCount: arg.sampleCount ?? 1
  };
}
function signatureKeyOf(sig) {
  return `${sig.colors.join(",")}:${sig.depth ?? "none"}:${sig.sampleCount ?? 1}`;
}
function validateTargetSignature(sig, where) {
  if (!Array.isArray(sig.colors) || sig.colors.length === 0)
    throw compileSignatureInvalidError(where, "colors must be a non-empty array.");
  const invalidColor = sig.colors.find((format) => typeof format !== "string" || format.length === 0);
  if (invalidColor !== void 0)
    throw compileSignatureInvalidError(where, `colors must contain only GPUTextureFormat strings; received ${String(invalidColor)}.`);
  if (sig.depth !== void 0 && (typeof sig.depth !== "string" || sig.depth.length === 0))
    throw compileSignatureInvalidError(where, "depth must be a GPUTextureFormat string.");
  const sampleCount = sig.sampleCount ?? 1;
  if (sampleCount !== 1 && sampleCount !== 4)
    throw compileSignatureInvalidError(where, `sampleCount must be 1 or 4; received ${String(sampleCount)}.`);
}
function pipelineKeyOf(parts) {
  let key = `${idFor(shaderModuleIds, parts.vertexModule, () => nextShaderModuleId++)}|${idFor(shaderModuleIds, parts.fragmentModule, () => nextShaderModuleId++)}|${idFor(pipelineLayoutIds, parts.pipelineLayout, () => nextPipelineLayoutId++)}|${vertexLayoutHash(parts.vertexBufferLayouts ?? [])}|${signatureKeyOf(parts.signature)}`;
  if (parts.topology || parts.stripIndexFormat)
    key += `|${parts.topology ?? "triangle-list"}|${parts.stripIndexFormat ?? "none"}`;
  if (parts.cullMode || parts.frontFace)
    key += `|${parts.cullMode ?? "none"}|${parts.frontFace ?? "ccw"}`;
  if (parts.unclippedDepth)
    key += "|unclipped";
  for (const suffix of [parts.depthKey, parts.stencilKey, parts.multisampleKey, parts.constantsKey, parts.entryKey, parts.fragmentKey])
    if (suffix)
      key += `|${suffix}`;
  return key;
}
function selectEntryPoint(label, entryPoints2, stage, name, where) {
  if (name === void 0) {
    const preferred = { vertex: "vs_main", fragment: "fs_main", compute: "cs_main" }[stage];
    let first;
    for (const entry of entryPoints2) {
      if (entry.stage !== stage)
        continue;
      first ??= entry;
      if (entry.name === preferred)
        return entry;
    }
    return first;
  }
  if (typeof name !== "string") {
    throw entryInvalidError(label, `${stage} received ${previewConstant(name)}; expected an entry point name string.`, where);
  }
  const named = entryPoints2.find((entry) => entry.name === name);
  if (!named) {
    throw entryInvalidError(label, `"${name}" matches no entry point in the shader; available entry points: ${availableEntryPoints(entryPoints2)}.`, where);
  }
  if (named.stage !== stage) {
    throw entryInvalidError(label, `"${name}" is a @${named.stage} entry point, not @${stage}; available entry points: ${availableEntryPoints(entryPoints2)}.`, where);
  }
  return named;
}
function availableEntryPoints(entryPoints2) {
  if (!entryPoints2.length)
    return "none";
  return entryPoints2.map((entry) => `"${entry.name}" (@${entry.stage})`).join(", ");
}
function normalizeConstantsOptions(label, value, overrides, where) {
  if (value !== void 0 && (typeof value !== "object" || value === null || Array.isArray(value))) {
    throw constantsInvalidError(label, `received ${previewConstant(value)}; expected { overrideNameOrId: number | boolean }.`, where);
  }
  const byIdentifier = new Map(overrides.map((override) => [overrideIdentifierOf(override), override]));
  const constants = {};
  for (const [key, entry] of Object.entries(value ?? {})) {
    if (!byIdentifier.has(key)) {
      throw constantsInvalidError(label, `"${key}" matches no override in the shader; available overrides: ${availableOverrides(overrides)}.`, where);
    }
    if (typeof entry === "boolean") {
      constants[key] = entry ? 1 : 0;
      continue;
    }
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      throw constantsInvalidError(label, `"${key}" received ${previewConstant(entry)}; use a finite number or a boolean (WebGPU converts the value to the override's WGSL type, and NaN/Infinity fail that conversion).`, where);
    }
    constants[key] = entry;
  }
  for (const override of overrides) {
    const identifier = overrideIdentifierOf(override);
    if (override.defaultValue === void 0 && !(identifier in constants)) {
      throw constantsInvalidError(label, `override '${override.name}' has no default value and must be provided; add constants: { "${identifier}": value }.`, where);
    }
  }
  if (Object.keys(constants).length === 0)
    return {};
  return { constants, constantsKey: constantsKeyFor(constants) };
}
function overrideIdentifierOf(override) {
  return override.id !== void 0 ? String(override.id) : override.name;
}
function availableOverrides(overrides) {
  if (!overrides.length)
    return "none";
  return overrides.map((override) => override.id !== void 0 ? `"${override.id}" (@id of ${override.name})` : `"${override.name}"`).join(", ");
}
function constantsKeyFor(constants) {
  return `cn~${Object.entries(constants).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => `${key}=${entry}`).join("~")}`;
}
function previewConstant(value) {
  if (typeof value === "string")
    return `"${value}"`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
function createShaderModuleCache(device, observe) {
  const modules = /* @__PURE__ */ new Map();
  return {
    get(source, label) {
      let module = modules.get(source);
      if (!module) {
        module = nativeObject(device, () => device.gpu.createShaderModule({ label, code: source }));
        modules.set(source, module);
        observe?.(module, label);
      }
      return module;
    },
    dispose() {
      modules.clear();
    }
  };
}
function createPipelineLayoutCache(device, observe) {
  const layouts = /* @__PURE__ */ new Map();
  return {
    get(bindGroupLayouts) {
      const key = pipelineLayoutKeyOf(bindGroupLayouts);
      let layout = layouts.get(key);
      if (!layout) {
        layout = nativeObject(device, () => device.gpu.createPipelineLayout({ bindGroupLayouts: contiguousLayouts(bindGroupLayouts) }), [...bindGroupLayouts.values()]);
        layouts.set(key, layout);
        observe?.(layout, "pipeline.layout");
      }
      return layout;
    },
    dispose() {
      layouts.clear();
    }
  };
}
function createPipelineStore(device, opts = {}) {
  return new DevicePipelineStore(device, opts);
}
var DevicePipelineStore = class {
  device;
  #entries = /* @__PURE__ */ new Map();
  #tracked = /* @__PURE__ */ new Set();
  #errorSink;
  #unregisterSettledSource;
  #disposed = false;
  constructor(device, opts) {
    this.device = device;
    this.#errorSink = opts.errorSink ?? (() => void 0);
    this.#unregisterSettledSource = opts.registerSettledSource?.(() => [...this.#tracked]);
  }
  getReady(key) {
    return this.#entries.get(key)?.pipeline;
  }
  async failure(key) {
    const entry = this.#entries.get(key);
    await entry?.validation;
    return entry?.failure ?? null;
  }
  getSync(key, create, ctx) {
    this.#assertUsable(ctx.where);
    let entry = this.#entries.get(key);
    if (entry?.failure && !ctx.retry)
      throw entry.failure;
    if (entry?.pipeline)
      return entry.pipeline;
    if (!entry || entry.failure) {
      entry = { generation: 0 };
      this.#entries.set(key, entry);
    }
    const current = entry;
    const generation = ++current.generation;
    try {
      const { value, error } = nativeScope(this.device, create);
      current.pipeline = value;
      const validation = Promise.all([objectValidation(ctx.dependencies ?? []), error]).then(async (errors) => {
        if (this.#disposed || current.generation !== generation)
          return;
        const cause = errors.find(Boolean);
        if (cause) {
          const failure = compileFailedError(ctx.where, cause, ctx.signature);
          current.failure = failure;
          current.pipeline = void 0;
          current.pending?.reject(failure);
          current.pending = void 0;
          await this.#errorSink(failure);
        } else {
          current.validated = true;
          current.pending?.resolve(value);
          current.pending = void 0;
        }
      });
      current.validation = validation;
      this.#track(validation);
      return value;
    } catch (cause) {
      const error = compileFailedError(ctx.where, cause, ctx.signature);
      current.failure = error;
      current.pending?.reject(error);
      current.pending = void 0;
      throw error;
    }
  }
  getAsync(key, create, ctx) {
    this.#assertUsable(ctx.where);
    let entry = this.#entries.get(key);
    if (entry?.pipeline) {
      if (entry.validated)
        return Promise.resolve(entry.pipeline);
      entry.pending ??= createDeferred();
      return entry.pending.promise;
    }
    if (entry?.pending)
      return entry.pending.promise;
    entry = { generation: 0, pending: createDeferred() };
    this.#entries.set(key, entry);
    const current = entry;
    const pending = current.pending;
    const generation = ++current.generation;
    let native;
    let scope;
    try {
      const captured = nativeScope(this.device, create);
      native = captured.value;
      scope = captured.error;
    } catch (cause) {
      native = Promise.reject(cause);
      scope = Promise.resolve(null);
    }
    const work = Promise.all([native.then((value) => ({ value }), (cause) => ({ cause })), objectValidation(ctx.dependencies ?? []), scope]).then(([result, dependencyError, nativeError]) => {
      if (this.#disposed || current.generation !== generation)
        return;
      const cause = dependencyError ?? nativeError ?? ("cause" in result ? result.cause : void 0);
      if (cause || "cause" in result) {
        current.failure = compileFailedError(ctx.where, cause, ctx.signature);
        pending.reject(current.failure);
      } else {
        current.pipeline = result.value;
        current.validated = true;
        pending.resolve(current.pipeline);
      }
      current.pending = void 0;
    });
    this.#track(work);
    return pending.promise;
  }
  dispose() {
    if (this.#disposed)
      return;
    this.#disposed = true;
    for (const entry of this.#entries.values())
      entry.pending?.reject(compileDisposedError("gpu.dispose"));
    this.#entries.clear();
    this.#tracked.clear();
    this.#unregisterSettledSource?.();
  }
  #assertUsable(where) {
    if (this.#disposed)
      throw compileDisposedError(where);
  }
  #track(promise) {
    this.#tracked.add(promise);
    void promise.then(() => this.#tracked.delete(promise), () => this.#tracked.delete(promise));
  }
};
function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  void promise.catch(() => void 0);
  return { promise, resolve, reject };
}
function idFor(ids, value, next) {
  let id = ids.get(value);
  if (!id) {
    id = next();
    ids.set(value, id);
  }
  return id;
}
function vertexLayoutHash(layouts) {
  return JSON.stringify(layouts.map((layout) => ({
    arrayStride: layout.arrayStride,
    stepMode: layout.stepMode ?? "vertex",
    attributes: [...layout.attributes].map((attribute) => ({
      shaderLocation: attribute.shaderLocation,
      offset: attribute.offset,
      format: attribute.format
    }))
  })));
}
function pipelineLayoutKeyOf(layouts) {
  return JSON.stringify([...layouts.entries()].map(([group, layout]) => ({ group, entries: layoutEntries(layout) })));
}
function contiguousLayouts(bindGroupLayouts) {
  const maxGroup = Math.max(-1, ...bindGroupLayouts.keys());
  const layouts = [];
  for (let i = 0; i <= maxGroup; i++)
    layouts.push(requiredLayout(bindGroupLayouts, i));
  return layouts;
}
function requiredLayout(bindGroupLayouts, group) {
  const layout = bindGroupLayouts.get(group);
  if (!layout)
    throw pipelineLayoutGapError(group);
  return layout;
}
function layoutEntries(layout) {
  return (bindGroupLayoutMetadata(layout)?.entries ?? []).map((entry) => ({
    binding: entry.binding,
    visibility: entry.visibility,
    buffer: entry.buffer ? { ...entry.buffer } : void 0,
    sampler: entry.sampler ? { ...entry.sampler } : void 0,
    texture: entry.texture ? { ...entry.texture } : void 0,
    storageTexture: entry.storageTexture ? { ...entry.storageTexture } : void 0,
    externalTexture: entry.externalTexture ? { ...entry.externalTexture } : void 0
  }));
}

// node_modules/vgpu/dist/frame-state.js
var frameStateToken = serviceToken("frame-state");
function frameState(kernel) {
  return kernel.service(frameStateToken, createFrameState);
}
function createFrameState() {
  const hooks = /* @__PURE__ */ new Set();
  let lastTimeMs = nowMs();
  let ticking = false;
  let manualPending = false;
  const state = {
    time: 0,
    deltaTime: 0,
    frameCount: 0,
    advanceBy(dtSeconds) {
      state.deltaTime = dtSeconds;
      state.time += dtSeconds;
      manualPending = true;
    },
    tick() {
      if (ticking)
        throw frameReentrantError();
      ticking = true;
      try {
        const next = nowMs();
        if (manualPending) {
          manualPending = false;
        } else {
          state.deltaTime = Math.max(0, (next - lastTimeMs) / 1e3);
          state.time += state.deltaTime;
        }
        lastTimeMs = next;
        state.frameCount += 1;
        for (const hook of [...hooks])
          hook();
      } finally {
        ticking = false;
      }
    },
    onAdvance(hook) {
      hooks.add(hook);
      return () => {
        hooks.delete(hook);
      };
    }
  };
  return state;
}
function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

// node_modules/vgpu/dist/surface.js
function surface(gpu, canvas, opts = {}) {
  const kernel = liveKernel(gpu, "surface");
  const open = openSurfaces(kernel);
  const existing = open.get(canvas);
  if (existing && !existing.disposed)
    throw surfaceDuplicateError(existing.label);
  const created = new CanvasSurface(kernel.device, canvas, opts, (disposed2) => {
    if (open.get(disposed2.canvas) === disposed2)
      open.delete(disposed2.canvas);
    releaseAutoResize();
    releaseOwnership();
  });
  const releaseAutoResize = frameState(kernel).onAdvance(() => created.applyAutoResize());
  const releaseOwnership = kernel.own("resource", () => created.dispose());
  open.set(canvas, created);
  return created;
}
var openSurfacesToken = serviceToken("surfaces");
function openSurfaces(kernel) {
  return kernel.service(openSurfacesToken, () => /* @__PURE__ */ new Map());
}
var resizeCallbackDepth = 0;
var frameDepth = 0;
function isSurfaceResizeCallbackActive() {
  return resizeCallbackDepth > 0;
}
function isFrameActive() {
  return frameDepth > 0;
}
function enterFrame() {
  frameDepth += 1;
}
function leaveFrame() {
  frameDepth -= 1;
}
function isSurface(target2) {
  return target2 instanceof CanvasSurface;
}
var CanvasSurface = class {
  device;
  canvas;
  options;
  unregister;
  [SURFACE_TARGET] = true;
  resourceIdentity = createResourceIdentity("render-target");
  label;
  context;
  autoResize;
  layoutBacked;
  format;
  #signature;
  #depthFormat;
  #sampleCount;
  #destroySignal = new DestroySignal();
  #callbacks = /* @__PURE__ */ new Set();
  #texturesRecreatedCallbacks = /* @__PURE__ */ new Set();
  #currentDpr;
  #clearColor;
  #attachments;
  #generationSize;
  #isDisposed = false;
  #notifying = false;
  constructor(device, canvas, options, unregister) {
    this.device = device;
    this.canvas = canvas;
    this.options = options;
    this.unregister = unregister;
    this.label = options.label;
    this.#clearColor = options.clearColor === void 0 ? BUILT_IN_CLEAR_COLOR : validateClearColor(options.clearColor, "surface.clearColor");
    const context = canvas.getContext("webgpu");
    if (!context)
      throw surfaceContextError();
    this.context = context;
    this.layoutBacked = isLayoutBacked(canvas);
    if (options.autoResize === true && !this.layoutBacked)
      throw surfaceAutoResizeUnsupportedError();
    this.autoResize = options.autoResize ?? (options.size ? false : this.layoutBacked);
    this.#currentDpr = effectiveDpr(options.dpr);
    this.format = options.format ?? preferredCanvasFormat();
    this.#depthFormat = surfaceDepthFormat(options.depth);
    this.#sampleCount = surfaceSampleCount(options.msaa);
    this.#signature = Object.freeze({ colors: Object.freeze([this.format]), depth: this.#depthFormat, sampleCount: this.#sampleCount });
    const previousSize = canvasSize(canvas);
    const initialSize = initialCanvasSize(canvas, options, this.layoutBacked, this.#currentDpr);
    if (options.size || this.layoutBacked)
      setCanvasSize(canvas, initialSize);
    try {
      context.configure({
        device: device.gpu,
        format: this.format,
        alphaMode: options.alphaMode ?? "premultiplied",
        colorSpace: options.colorSpace ?? "srgb",
        usage: canvasTextureUsage()
      });
      this.#attachments = this.#allocateAttachments(initialSize);
      this.#generationSize = Object.freeze([...initialSize]);
    } catch (error) {
      try {
        context.unconfigure?.();
      } catch {
      }
      if (options.size || this.layoutBacked) {
        try {
          setCanvasSize(canvas, previousSize);
        } catch {
        }
      }
      throw error;
    }
  }
  get gpu() {
    return this.context;
  }
  get size() {
    this.#assertLive();
    return canvasSize(this.canvas);
  }
  get texelSize() {
    const size = this.size;
    return [1 / size[0], 1 / size[1]];
  }
  get color() {
    this.#assertLive();
    return new Texture(this.device, this.context.getCurrentTexture(), {
      kind: "2d",
      size: this.size,
      format: this.format,
      usage: ["render_attachment", "texture_binding", "copy_src"],
      label: this.options.label ? `${this.options.label}.color` : "surface.color"
    }, "external");
  }
  get colors() {
    return [this.color];
  }
  get depth() {
    this.#assertLive();
    return this.#attachments.depth;
  }
  get sampleCount() {
    this.#assertLive();
    return this.#sampleCount;
  }
  get dpr() {
    return this.#currentDpr;
  }
  /** Default clear color of this surface; passes that clear without naming a color use it. */
  get clearColor() {
    return copyClearColor(this.#clearColor);
  }
  set clearColor(value) {
    this.#clearColor = validateClearColor(value, "surface.clearColor");
  }
  get disposed() {
    return this.#isDisposed;
  }
  [TARGET_SIGNATURE]() {
    this.#assertLive();
    return this.#signature;
  }
  resize(size) {
    this.#assertLive();
    if (this.#notifying)
      throw surfaceResizeReentrantError(this.options.label);
    this.#applyResize(sanitizeSize(size), this.#currentDpr, true);
  }
  applyAutoResize() {
    if (this.#isDisposed)
      return;
    if (this.autoResize && this.layoutBacked) {
      const nextDpr = effectiveDpr(this.options.dpr);
      const nextSize = layoutCanvasSize(this.canvas, nextDpr);
      this.#applyResize(nextSize, nextDpr, true);
      return;
    }
    const currentCanvasSize = sanitizeSize(canvasSize(this.canvas));
    if (!sameSize(this.#generationSize, currentCanvasSize)) {
      this.#applyResize(currentCanvasSize, this.#currentDpr, false);
    }
  }
  onResize(cb) {
    this.#assertLive();
    this.#callbacks.add(cb);
    const wasNotifying = this.#notifying;
    this.#notifying = true;
    resizeCallbackDepth += 1;
    try {
      cb(this.#event());
    } finally {
      resizeCallbackDepth -= 1;
      this.#notifying = wasNotifying;
    }
    return () => {
      this.#callbacks.delete(cb);
    };
  }
  onDestroy(cb) {
    this.#assertLive();
    return this.#destroySignal.onDestroy(this, cb);
  }
  onTexturesRecreated(cb) {
    this.#assertLive();
    this.#texturesRecreatedCallbacks.add(cb);
    return () => {
      this.#texturesRecreatedCallbacks.delete(cb);
    };
  }
  renderPassDescriptor(opts = {}) {
    const { clear = [0, 0, 0, 1], preserve, clearDepth, clearStencil, depthReadOnly } = opts;
    this.#assertLive();
    const currentCanvasSize = sanitizeSize(canvasSize(this.canvas));
    if (!sameSize(this.#generationSize, currentCanvasSize)) {
      this.#applyResize(currentCanvasSize, this.#currentDpr, false);
    }
    const resolved = this.context.getCurrentTexture();
    return {
      colorAttachments: [colorAttachment(resolved, this.#attachments.msaaColor, clear, preserve)],
      depthStencilAttachment: this.#attachments.depth ? depthAttachment(this.#attachments.depth, preserve, clearDepth, clearStencil, depthReadOnly) : void 0
    };
  }
  dispose() {
    if (this.#isDisposed)
      return;
    this.#isDisposed = true;
    try {
      this.context.unconfigure?.();
    } catch {
    }
    const errors = [];
    try {
      this.unregister(this);
    } catch (error) {
      errors.push(error);
    }
    this.#callbacks.clear();
    this.#texturesRecreatedCallbacks.clear();
    try {
      this.#destroySignal.emit(this);
    } catch (error) {
      errors.push(error);
    }
    try {
      destroyTextures(this.#attachments.all);
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      throw errors[0];
  }
  #applyResize(size, dpr, notify) {
    const generationChanged = !sameSize(this.#generationSize, size);
    const canvasChanged = !sameSize(canvasSize(this.canvas), size);
    if (!generationChanged && !canvasChanged) {
      this.#currentDpr = dpr;
      return;
    }
    const nextSize = Object.freeze([...size]);
    const next = generationChanged ? this.#allocateAttachments(nextSize) : this.#attachments;
    const previous = this.#attachments;
    const notifyPublic = notify && (canvasChanged || generationChanged && previous.all.length > 0);
    const wasNotifying = this.#notifying;
    this.#notifying = true;
    resizeCallbackDepth += 1;
    try {
      if (canvasChanged)
        setCanvasSize(this.canvas, nextSize);
      this.#currentDpr = dpr;
      this.#generationSize = nextSize;
      this.#attachments = next;
      const errors = [];
      try {
        this.#emitTexturesRecreated();
      } catch (error) {
        errors.push(error);
      }
      if (notifyPublic) {
        try {
          this.#notify();
        } catch (error) {
          errors.push(error);
        }
      }
      if (generationChanged) {
        try {
          destroyTextures(previous.all);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length)
        throw errors[0];
    } finally {
      resizeCallbackDepth -= 1;
      this.#notifying = wasNotifying;
    }
  }
  #emitTexturesRecreated() {
    const errors = [];
    for (const cb of [...this.#texturesRecreatedCallbacks]) {
      try {
        cb();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw errors[0];
  }
  #notify() {
    const event = this.#event();
    const errors = [];
    for (const cb of [...this.#callbacks]) {
      try {
        cb(event);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw errors[0];
  }
  #event() {
    const size = canvasSize(this.canvas);
    return { width: size[0], height: size[1], dpr: this.#currentDpr, surface: this };
  }
  #assertLive() {
    if (this.#isDisposed)
      throw surfaceDisposedError(this.options.label);
  }
  #allocateAttachments(size) {
    const allocated = [];
    const create = (options) => {
      const texture = this.device.createTexture(options);
      allocated.push(texture);
      return texture;
    };
    try {
      const msaaColor = this.#sampleCount === 4 ? create({
        kind: "2d",
        size,
        format: this.format,
        usage: ["render_attachment"],
        sampleCount: 4,
        label: this.options.label ? `${this.options.label}.color.msaa` : "surface.color.msaa"
      }) : void 0;
      const depth = this.#depthFormat ? create({
        kind: "2d",
        size,
        format: this.#depthFormat,
        usage: ["render_attachment", "texture_binding"],
        sampleCount: this.#sampleCount,
        label: this.options.label ? `${this.options.label}.depth` : "surface.depth"
      }) : void 0;
      return { msaaColor, depth, all: allocated };
    } catch (error) {
      try {
        destroyTextures(allocated);
      } catch {
      }
      throw error;
    }
  }
};
var SURFACE_DEPTH_FORMATS = /* @__PURE__ */ new Set([
  "depth16unorm",
  "depth24plus",
  "depth24plus-stencil8",
  "depth32float",
  "depth32float-stencil8"
]);
function surfaceDepthFormat(value) {
  if (value === void 0 || value === false)
    return void 0;
  if (value === true)
    return "depth24plus";
  if (SURFACE_DEPTH_FORMATS.has(value))
    return value;
  throw surfaceDepthInvalidError(value);
}
function surfaceSampleCount(value) {
  if (value === void 0 || value === false)
    return 1;
  if (value === true || value === 4)
    return 4;
  throw surfaceMsaaInvalidError(value);
}
function destroyTextures(textures) {
  const errors = [];
  for (const texture of textures) {
    try {
      texture.destroy();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw errors[0];
}
function isLayoutBacked(canvas) {
  return typeof canvas.clientWidth === "number";
}
function initialCanvasSize(canvas, options, layoutBacked, dpr) {
  if (options.size)
    return sanitizeSize(options.size);
  if (layoutBacked)
    return layoutCanvasSize(canvas, dpr);
  return sanitizeSize(canvasSize(canvas));
}
function layoutCanvasSize(canvasLike, dpr) {
  const canvas = canvasLike;
  return sanitizeSize([Math.round(canvas.clientWidth * dpr), Math.round(canvas.clientHeight * dpr)]);
}
function canvasSize(canvasLike) {
  const canvas = canvasLike;
  return [canvas.width, canvas.height];
}
function setCanvasSize(canvasLike, size) {
  const canvas = canvasLike;
  canvas.width = size[0];
  canvas.height = size[1];
}
function sanitizeSize(size) {
  return [Math.max(1, Math.floor(size[0])), Math.max(1, Math.floor(size[1]))];
}
function effectiveDpr(dpr) {
  const raw = globalThis.devicePixelRatio ?? 1;
  if (Array.isArray(dpr))
    return Math.min(dpr[1], Math.max(dpr[0], raw));
  if (typeof dpr === "number")
    return dpr;
  return raw;
}
function preferredCanvasFormat() {
  return globalThis.navigator?.gpu?.getPreferredCanvasFormat?.() ?? "bgra8unorm";
}
function canvasTextureUsage() {
  const usage = globalThis.GPUTextureUsage;
  return usage ? usage.RENDER_ATTACHMENT | usage.TEXTURE_BINDING | usage.COPY_SRC : void 0;
}

// node_modules/vgpu/dist/indirect.js
var INDIRECT_METHODS = {
  drawIndirect: { bytes: 16, args: "4 u32 values: vertexCount, instanceCount, firstVertex, firstInstance" },
  drawIndexedIndirect: { bytes: 20, args: "5 32-bit values: indexCount, instanceCount, firstIndex, baseVertex (signed), firstInstance" },
  dispatchWorkgroupsIndirect: { bytes: 12, args: "3 u32 values: workgroupCountX, workgroupCountY, workgroupCountZ" }
};
function resolveIndirect(label, where, value, method, device) {
  const wrapped = typeof value === "object" && value !== null ? value.buffer : void 0;
  const storage2 = isStorageBufferFacade(value) ? value : isStorageBufferFacade(wrapped) ? wrapped : void 0;
  if (!storage2)
    throw indirectInvalidError(label, `received ${previewIndirect(value)}; expected a StorageBuffer or { buffer, offset? }.`, where);
  assertBufferUsable(storage2.buffer, where, device);
  const offset = storage2 === value ? 0 : value.offset ?? 0;
  if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0)
    throw indirectInvalidError(label, `offset must be an integer >= 0; received ${previewIndirect(offset)}.`, where);
  if (offset % 4 !== 0)
    throw indirectInvalidError(label, `offset must be a multiple of 4 (WebGPU requires "indirectOffset is a multiple of 4"); received ${offset}.`, where);
  if (!storage2.buffer.options.usage.includes("indirect")) {
    throw indirectInvalidError(label, `the buffer lacks the "indirect" usage (WebGPU requires "indirectBuffer.usage contains INDIRECT"); create it with storage(gpu, ${storage2.size}, { indirect: true }).`, where);
  }
  const { bytes, args } = INDIRECT_METHODS[method];
  if (offset + bytes > storage2.size) {
    throw indirectInvalidError(label, `${method} reads ${bytes} bytes (${args}) at offset ${offset}, but offset + ${bytes} = ${offset + bytes} exceeds the buffer size ${storage2.size}.`, where);
  }
  return { buffer: storage2.gpu, offset };
}
function isStorageBufferFacade(value) {
  return typeof value === "object" && value !== null && "gpu" in value && "size" in value && value.buffer instanceof Buffer;
}
function previewIndirect(value) {
  if (typeof value === "string")
    return `"${value}"`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

// node_modules/vgpu/dist/frame-protocols.js
var FRAME_DRAWABLE = /* @__PURE__ */ Symbol("vgpu.frame.drawable");
function frameDrawableOf(value) {
  return value?.[FRAME_DRAWABLE];
}
var FRAME_BUNDLE = /* @__PURE__ */ Symbol("vgpu.frame.bundle");
function frameBundleOf(value) {
  return value?.[FRAME_BUNDLE];
}
var FRAME_PASS_ATTACHMENT = /* @__PURE__ */ Symbol("vgpu.frame.passAttachment");
function framePassAttachmentOf(value) {
  const attach = value?.[FRAME_PASS_ATTACHMENT];
  return typeof attach === "function" ? value : void 0;
}
var FRAME_COMPUTE = /* @__PURE__ */ Symbol("vgpu.frame.compute");
function frameComputeOf(value) {
  return value?.[FRAME_COMPUTE];
}

// node_modules/vgpu/dist/sampler.js
function sampler(gpu, desc) {
  return renderService(liveKernel(gpu, "sampler")).sampler(desc);
}
var nextSamplerId = 1;
function createSamplerCache(device) {
  const byKey = /* @__PURE__ */ new Map();
  const ids = /* @__PURE__ */ new WeakMap();
  return {
    sampler(desc = {}) {
      const key = stableKey(desc);
      let sampler2 = byKey.get(key);
      if (!sampler2) {
        sampler2 = device.gpu.createSampler(desc);
        byKey.set(key, sampler2);
        ids.set(sampler2, { kind: "sampler", id: nextSamplerId++ });
      }
      return sampler2;
    },
    identity(sampler2) {
      let id = ids.get(sampler2);
      if (!id) {
        id = { kind: "sampler", id: nextSamplerId++ };
        ids.set(sampler2, id);
      }
      return id;
    }
  };
}
function stableKey(value) {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map(stableKey).join(",")}]`;
  const record = value;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableKey(record[key])}`).join(",")}}`;
}

// node_modules/vgpu/dist/render-service.js
var renderServiceToken = serviceToken("render-service");
function renderService(kernel) {
  return kernel.service(renderServiceToken, createRenderService);
}
function createRenderService(kernel) {
  const device = kernel.device;
  const binds = createBindGroupCache();
  const pipelines = createPipelineStore(device, {
    errorSink: (error) => kernel.reportError(error),
    registerSettledSource: (source) => kernel.registerSettledSource(source)
  });
  const computePipelines = createPipelineStore(device, { errorSink: (error) => kernel.reportError(error), registerSettledSource: (source) => kernel.registerSettledSource(source) });
  const pendingObjects = /* @__PURE__ */ new Set();
  const unregisterObjects = kernel.registerSettledSource(() => [...pendingObjects]);
  const observe = (object, where) => {
    const pending = deliverObjectValidation(object, where, (error) => kernel.reportError(error));
    pendingObjects.add(pending);
    void pending.then(() => pendingObjects.delete(pending), () => pendingObjects.delete(pending));
  };
  const shaderModules = createShaderModuleCache(device, observe);
  const pipelineLayouts = createPipelineLayoutCache(device, observe);
  const samplers = createSamplerCache(device);
  kernel.own("service", () => {
    pendingObjects.clear();
    unregisterObjects();
    pipelines.dispose();
    computePipelines.dispose();
    shaderModules.dispose();
    pipelineLayouts.dispose();
    binds.dispose();
  });
  return { binds, pipelines, computePipelines, shaderModules, pipelineLayouts, sampler: (desc) => samplers.sampler(desc) };
}

// node_modules/vgpu/dist/shader-source-snapshot.js
var active = /* @__PURE__ */ new WeakSet();
var provenFrozen = true;
function clonePreparedShaderData(input) {
  const outer = provenFrozen;
  provenFrozen = true;
  try {
    const data = withRecord(input, "shader", (object) => {
      const functionExports = optional(object, "functionExports", "functionExports");
      const reflection = cloneReflection(required(object, "reflection", "reflection"), "reflection");
      validateReflection(reflection);
      return {
        wgsl: stringField(object, "wgsl", "wgsl", true),
        reflection,
        sourceChecksum: stringField(object, "sourceChecksum", "sourceChecksum"),
        producer: stringField(object, "producer", "producer"),
        ...functionExports.present ? { functionExports: cloneArray(functionExports.value, "functionExports", cloneFunctionExport) } : {}
      };
    });
    return [data, provenFrozen];
  } finally {
    provenFrozen = outer;
  }
}
function isProvenFrozen(value) {
  try {
    return Object.isFrozen(value);
  } catch {
    return false;
  }
}
function noteFrozen(value) {
  if (!isProvenFrozen(value))
    provenFrozen = false;
}
function cloneReflection(value, path) {
  return withRecord(value, path, (object) => ({
    bindings: cloneArray(required(object, "bindings", `${path}.bindings`), `${path}.bindings`, cloneBinding),
    entryPoints: cloneArray(required(object, "entryPoints", `${path}.entryPoints`), `${path}.entryPoints`, cloneEntryPoint),
    overrides: cloneArray(required(object, "overrides", `${path}.overrides`), `${path}.overrides`, cloneOverride),
    featuresRequired: cloneArray(required(object, "featuresRequired", `${path}.featuresRequired`), `${path}.featuresRequired`, cloneNonemptyString),
    aliases: cloneArray(required(object, "aliases", `${path}.aliases`), `${path}.aliases`, cloneAlias),
    structs: cloneArray(required(object, "structs", `${path}.structs`), `${path}.structs`, cloneStruct),
    hostShareableLayouts: cloneArray(required(object, "hostShareableLayouts", `${path}.hostShareableLayouts`), `${path}.hostShareableLayouts`, cloneLayout)
  }));
}
function cloneBinding(value, path) {
  return withRecord(value, path, (object) => {
    const addressSpace = optional(object, "addressSpace", `${path}.addressSpace`);
    const access = optional(object, "access", `${path}.access`);
    const struct = optional(object, "struct", `${path}.struct`);
    const layout = optional(object, "layout", `${path}.layout`);
    const bindingLayout = optional(object, "bindingLayout", `${path}.bindingLayout`);
    return {
      group: nonnegativeInteger(required(object, "group", `${path}.group`), `${path}.group`),
      binding: nonnegativeInteger(required(object, "binding", `${path}.binding`), `${path}.binding`),
      name: stringField(object, "name", `${path}.name`),
      mangledName: stringField(object, "mangledName", `${path}.mangledName`),
      type: cloneType(required(object, "type", `${path}.type`), `${path}.type`),
      kind: oneOf(required(object, "kind", `${path}.kind`), `${path}.kind`, ["buffer", "texture", "sampler", "externalTexture", "unknown"]),
      ...addressSpace.present ? { addressSpace: oneOf(addressSpace.value, `${path}.addressSpace`, ["function", "private", "workgroup", "uniform", "storage", "handle"]) } : {},
      ...access.present ? { access: oneOf(access.value, `${path}.access`, ["read", "write", "read_write"]) } : {},
      ...struct.present ? { struct: cloneStruct(struct.value, `${path}.struct`) } : {},
      ...layout.present ? { layout: cloneLayout(layout.value, `${path}.layout`) } : {},
      ...bindingLayout.present ? { bindingLayout: cloneBindingLayout(bindingLayout.value, `${path}.bindingLayout`) } : {}
    };
  });
}
function cloneEntryPoint(value, path) {
  return withRecord(value, path, (object) => {
    const stage = oneOf(required(object, "stage", `${path}.stage`), `${path}.stage`, ["vertex", "fragment", "compute"]);
    const workgroup = optional(object, "workgroupSize", `${path}.workgroupSize`);
    const inputs = optional(object, "inputs", `${path}.inputs`);
    if (stage === "vertex" && !inputs.present)
      fail(`${path}.inputs`, "vertex entries require input metadata");
    if (stage !== "compute" && workgroup.present)
      fail(`${path}.workgroupSize`, "only compute entries may declare a workgroup size");
    const decodedWorkgroup = workgroup.present ? cloneWorkgroupSize(workgroup.value, `${path}.workgroupSize`) : void 0;
    if (stage === "compute" && decodedWorkgroup === void 0)
      fail(`${path}.workgroupSize`, "compute entries require workgroup metadata");
    return {
      name: stringField(object, "name", `${path}.name`),
      mangledName: stringField(object, "mangledName", `${path}.mangledName`),
      stage,
      ...decodedWorkgroup ? { workgroupSize: decodedWorkgroup } : {},
      bindings: cloneArray(required(object, "bindings", `${path}.bindings`), `${path}.bindings`, cloneBindingRef),
      samplingPairs: cloneArray(required(object, "samplingPairs", `${path}.samplingPairs`), `${path}.samplingPairs`, cloneSamplingPair),
      ...inputs.present ? { inputs: cloneArray(inputs.value, `${path}.inputs`, cloneEntryInput) } : {}
    };
  });
}
function cloneWorkgroupSize(value, path) {
  const values = cloneArray(value, path, (axis, axisPath) => axis === "unresolved" ? Number.NaN : finiteNumber(axis, axisPath));
  if (values.length !== 3)
    fail(path, "expected exactly three workgroup axes");
  return values;
}
function cloneEntryInput(value, path) {
  return withRecord(value, path, (object) => ({
    name: stringField(object, "name", `${path}.name`),
    location: nonnegativeInteger(required(object, "location", `${path}.location`), `${path}.location`),
    type: cloneType(required(object, "type", `${path}.type`), `${path}.type`)
  }));
}
function cloneBindingRef(value, path) {
  return withRecord(value, path, (object) => ({
    group: nonnegativeInteger(required(object, "group", `${path}.group`), `${path}.group`),
    binding: nonnegativeInteger(required(object, "binding", `${path}.binding`), `${path}.binding`)
  }));
}
function cloneSamplingPair(value, path) {
  return withRecord(value, path, (object) => ({
    texture: cloneBindingRef(required(object, "texture", `${path}.texture`), `${path}.texture`),
    sampler: cloneBindingRef(required(object, "sampler", `${path}.sampler`), `${path}.sampler`),
    mode: oneOf(required(object, "mode", `${path}.mode`), `${path}.mode`, ["filtering", "comparison"])
  }));
}
function cloneOverride(value, path) {
  return withRecord(value, path, (object) => {
    const id = optional(object, "id", `${path}.id`);
    const defaultValue = optional(object, "defaultValue", `${path}.defaultValue`);
    return {
      name: stringField(object, "name", `${path}.name`),
      mangledName: stringField(object, "mangledName", `${path}.mangledName`),
      ...id.present ? { id: nonnegativeInteger(id.value, `${path}.id`) } : {},
      ...defaultValue.present ? { defaultValue: nonemptyString(defaultValue.value, `${path}.defaultValue`) } : {}
    };
  });
}
function cloneAlias(value, path) {
  return withRecord(value, path, (object) => ({
    name: stringField(object, "name", `${path}.name`),
    mangledName: stringField(object, "mangledName", `${path}.mangledName`),
    target: cloneType(required(object, "target", `${path}.target`), `${path}.target`)
  }));
}
function cloneStruct(value, path) {
  return withRecord(value, path, (object) => ({
    name: stringField(object, "name", `${path}.name`),
    mangledName: stringField(object, "mangledName", `${path}.mangledName`),
    members: cloneArray(required(object, "members", `${path}.members`), `${path}.members`, cloneStructMember)
  }));
}
function cloneStructMember(value, path) {
  return withRecord(value, path, (object) => {
    const align2 = optional(object, "align", `${path}.align`);
    const size = optional(object, "size", `${path}.size`);
    return {
      name: stringField(object, "name", `${path}.name`),
      type: cloneType(required(object, "type", `${path}.type`), `${path}.type`),
      ...align2.present ? { align: positivePowerOfTwo(align2.value, `${path}.align`) } : {},
      ...size.present ? { size: nonnegativeInteger(size.value, `${path}.size`) } : {}
    };
  });
}
function cloneFunctionExport(value, path) {
  return withRecord(value, path, (object) => ({
    name: stringField(object, "name", `${path}.name`),
    resolvedName: stringField(object, "resolvedName", `${path}.resolvedName`),
    parameterNames: cloneArray(required(object, "parameterNames", `${path}.parameterNames`), `${path}.parameterNames`, cloneNonemptyString)
  }));
}
function cloneType(value, path) {
  return withRecord(value, path, (object) => {
    const kind = nonemptyString(required(object, "kind", `${path}.kind`), `${path}.kind`);
    switch (kind) {
      case "scalar":
        return { kind, name: oneOf(required(object, "name", `${path}.name`), `${path}.name`, ["f32", "f16", "i32", "u32", "bool"]) };
      case "atomic":
        return { kind, element: cloneType(required(object, "element", `${path}.element`), `${path}.element`) };
      case "vector":
        return { kind, width: oneOf(required(object, "width", `${path}.width`), `${path}.width`, [2, 3, 4]), element: cloneType(required(object, "element", `${path}.element`), `${path}.element`) };
      case "matrix":
        return { kind, columns: oneOf(required(object, "columns", `${path}.columns`), `${path}.columns`, [2, 3, 4]), rows: oneOf(required(object, "rows", `${path}.rows`), `${path}.rows`, [2, 3, 4]), element: cloneType(required(object, "element", `${path}.element`), `${path}.element`) };
      case "array": {
        const count = optional(object, "count", `${path}.count`);
        const countExpression = optional(object, "countExpression", `${path}.countExpression`);
        return { kind, element: cloneType(required(object, "element", `${path}.element`), `${path}.element`), ...count.present ? { count: positiveInteger2(count.value, `${path}.count`) } : {}, ...countExpression.present ? { countExpression: nonemptyString(countExpression.value, `${path}.countExpression`) } : {} };
      }
      case "ptr": {
        const access = optional(object, "access", `${path}.access`);
        return { kind, addressSpace: nonemptyString(required(object, "addressSpace", `${path}.addressSpace`), `${path}.addressSpace`), element: cloneType(required(object, "element", `${path}.element`), `${path}.element`), ...access.present ? { access: nonemptyString(access.value, `${path}.access`) } : {} };
      }
      case "sampler":
        return { kind, comparison: booleanValue(required(object, "comparison", `${path}.comparison`), `${path}.comparison`) };
      case "texture": {
        const dimension = optional(object, "dimension", `${path}.dimension`);
        const sampleType = optional(object, "sampleType", `${path}.sampleType`);
        const texelFormat = optional(object, "texelFormat", `${path}.texelFormat`);
        const access = optional(object, "access", `${path}.access`);
        return {
          kind,
          textureKind: nonemptyString(required(object, "textureKind", `${path}.textureKind`), `${path}.textureKind`),
          ...dimension.present ? { dimension: oneOf(dimension.value, `${path}.dimension`, ["1d", "2d", "2d_array", "3d", "cube", "cube_array", "multisampled_2d", "depth_2d", "depth_2d_array", "depth_cube", "depth_cube_array", "depth_multisampled_2d"]) } : {},
          ...sampleType.present ? { sampleType: cloneType(sampleType.value, `${path}.sampleType`) } : {},
          ...texelFormat.present ? { texelFormat: nonemptyString(texelFormat.value, `${path}.texelFormat`) } : {},
          ...access.present ? { access: oneOf(access.value, `${path}.access`, ["read", "write", "read_write"]) } : {}
        };
      }
      case "identifier": {
        const mangledName = optional(object, "mangledName", `${path}.mangledName`);
        return { kind, name: stringField(object, "name", `${path}.name`), ...mangledName.present ? { mangledName: nonemptyString(mangledName.value, `${path}.mangledName`) } : {} };
      }
      default:
        return fail(`${path}.kind`, `unknown WGSL type '${kind}'`);
    }
  });
}
function cloneLayout(value, path) {
  return withRecord(value, path, (object) => {
    const size = optional(object, "size", `${path}.size`);
    const stride = optional(object, "stride", `${path}.stride`);
    const members = optional(object, "members", `${path}.members`);
    const element = optional(object, "element", `${path}.element`);
    const runtimeSized = optional(object, "runtimeSized", `${path}.runtimeSized`);
    const layout = {
      name: stringField(object, "name", `${path}.name`),
      mangledName: stringField(object, "mangledName", `${path}.mangledName`),
      layoutMode: oneOf(required(object, "layoutMode", `${path}.layoutMode`), `${path}.layoutMode`, ["wgsl-host-shareable-v1"]),
      type: cloneType(required(object, "type", `${path}.type`), `${path}.type`),
      align: positivePowerOfTwo(required(object, "align", `${path}.align`), `${path}.align`),
      ...size.present ? { size: nonnegativeInteger(size.value, `${path}.size`) } : {},
      ...stride.present ? { stride: positiveInteger2(stride.value, `${path}.stride`) } : {},
      ...members.present ? { members: cloneArray(members.value, `${path}.members`, cloneLayoutMember) } : {},
      ...element.present ? { element: cloneLayout(element.value, `${path}.element`) } : {},
      ...runtimeSized.present ? { runtimeSized: booleanValue(runtimeSized.value, `${path}.runtimeSized`) } : {}
    };
    validateLayout(layout, path);
    return layout;
  });
}
function cloneLayoutMember(value, path) {
  return withRecord(value, path, (object) => {
    const size = optional(object, "size", `${path}.size`);
    const explicitAlign = optional(object, "explicitAlign", `${path}.explicitAlign`);
    const explicitSize = optional(object, "explicitSize", `${path}.explicitSize`);
    return {
      name: stringField(object, "name", `${path}.name`),
      offset: nonnegativeInteger(required(object, "offset", `${path}.offset`), `${path}.offset`),
      align: positivePowerOfTwo(required(object, "align", `${path}.align`), `${path}.align`),
      ...size.present ? { size: nonnegativeInteger(size.value, `${path}.size`) } : {},
      type: cloneType(required(object, "type", `${path}.type`), `${path}.type`),
      layout: cloneLayout(required(object, "layout", `${path}.layout`), `${path}.layout`),
      ...explicitAlign.present ? { explicitAlign: positivePowerOfTwo(explicitAlign.value, `${path}.explicitAlign`) } : {},
      ...explicitSize.present ? { explicitSize: nonnegativeInteger(explicitSize.value, `${path}.explicitSize`) } : {}
    };
  });
}
function cloneBindingLayout(value, path) {
  return withRecord(value, path, (object) => {
    const kind = nonemptyString(required(object, "kind", `${path}.kind`), `${path}.kind`);
    switch (kind) {
      case "buffer":
        return { kind, buffer: withRecord(required(object, "buffer", `${path}.buffer`), `${path}.buffer`, (nested) => {
          const minBindingSize = optional(nested, "minBindingSize", `${path}.buffer.minBindingSize`);
          if (required(nested, "hasDynamicOffset", `${path}.buffer.hasDynamicOffset`) !== false)
            fail(`${path}.buffer.hasDynamicOffset`, "prepared layouts require false");
          return { type: oneOf(required(nested, "type", `${path}.buffer.type`), `${path}.buffer.type`, ["uniform", "storage", "read-only-storage"]), hasDynamicOffset: false, ...minBindingSize.present ? { minBindingSize: nonnegativeInteger(minBindingSize.value, `${path}.buffer.minBindingSize`) } : {} };
        }) };
      case "sampler":
        return { kind, sampler: withRecord(required(object, "sampler", `${path}.sampler`), `${path}.sampler`, (nested) => ({ type: oneOf(required(nested, "type", `${path}.sampler.type`), `${path}.sampler.type`, ["filtering", "non-filtering", "comparison"]) })) };
      case "texture":
        return { kind, texture: withRecord(required(object, "texture", `${path}.texture`), `${path}.texture`, (nested) => ({ sampleType: oneOf(required(nested, "sampleType", `${path}.texture.sampleType`), `${path}.texture.sampleType`, ["float", "unfilterable-float", "depth", "sint", "uint"]), viewDimension: oneOf(required(nested, "viewDimension", `${path}.texture.viewDimension`), `${path}.texture.viewDimension`, ["1d", "2d", "2d-array", "cube", "cube-array", "3d"]), multisampled: booleanValue(required(nested, "multisampled", `${path}.texture.multisampled`), `${path}.texture.multisampled`) })) };
      case "storageTexture":
        return { kind, storageTexture: withRecord(required(object, "storageTexture", `${path}.storageTexture`), `${path}.storageTexture`, (nested) => ({ access: oneOf(required(nested, "access", `${path}.storageTexture.access`), `${path}.storageTexture.access`, ["write-only", "read-only", "read-write"]), format: stringField(nested, "format", `${path}.storageTexture.format`), viewDimension: oneOf(required(nested, "viewDimension", `${path}.storageTexture.viewDimension`), `${path}.storageTexture.viewDimension`, ["1d", "2d", "2d-array", "cube", "cube-array", "3d"]) })) };
      case "externalTexture":
        return { kind, externalTexture: withRecord(required(object, "externalTexture", `${path}.externalTexture`), `${path}.externalTexture`, () => ({})) };
      default:
        return fail(`${path}.kind`, `unknown binding layout '${kind}'`);
    }
  });
}
function validateReflection(reflection) {
  const coordinates = /* @__PURE__ */ new Map();
  for (const [index, binding] of reflection.bindings.entries()) {
    const key = bindingKey(binding);
    if (coordinates.has(key))
      fail(`reflection.bindings[${index}]`, `duplicate binding coordinate ${key}`);
    coordinates.set(key, binding);
    if (binding.kind === "buffer") {
      const bindingPath = `reflection.bindings[${index}]`;
      const bindingLayout = binding.bindingLayout;
      if (bindingLayout?.kind !== "buffer")
        fail(`${bindingPath}.bindingLayout`, "does not match binding kind 'buffer'");
      if (binding.addressSpace !== "uniform" && binding.addressSpace !== "storage")
        fail(`${bindingPath}.addressSpace`, "buffer bindings require a uniform or storage address space");
      if (!binding.layout)
        fail(`${bindingPath}.layout`, "buffer bindings require host-shareable packing metadata");
      const expectedType = binding.addressSpace === "uniform" ? "uniform" : binding.access === "read" ? "read-only-storage" : "storage";
      if (bindingLayout.buffer.type !== expectedType)
        fail(`${bindingPath}.bindingLayout.buffer.type`, `does not match ${binding.addressSpace}${binding.access ? `/${binding.access}` : ""} buffer metadata`);
    } else {
      const expected = binding.kind === "sampler" ? "sampler" : binding.kind === "externalTexture" ? "externalTexture" : void 0;
      if (expected && binding.bindingLayout?.kind !== expected)
        fail(`reflection.bindings[${index}].bindingLayout`, `does not match binding kind '${binding.kind}'`);
      if (binding.kind === "texture" && binding.bindingLayout && binding.bindingLayout.kind !== "texture" && binding.bindingLayout.kind !== "storageTexture")
        fail(`reflection.bindings[${index}].bindingLayout`, "does not describe a texture binding");
    }
  }
  uniqueIdentities(reflection.structs, "reflection.structs");
  uniqueIdentities(reflection.aliases, "reflection.aliases");
  uniqueIdentities(reflection.overrides, "reflection.overrides");
  uniqueStrings(reflection.featuresRequired, "reflection.featuresRequired");
  const entryNames = /* @__PURE__ */ new Set();
  for (const [index, entry] of reflection.entryPoints.entries()) {
    if (entryNames.has(entry.name))
      fail(`reflection.entryPoints[${index}].name`, `duplicate entry identity '${entry.name}'`);
    entryNames.add(entry.name);
    const used = /* @__PURE__ */ new Set();
    for (const [refIndex, ref] of (entry.bindings ?? []).entries()) {
      const key = bindingKey(ref);
      if (!coordinates.has(key))
        fail(`reflection.entryPoints[${index}].bindings[${refIndex}]`, `dangling binding reference ${key}`);
      if (used.has(key))
        fail(`reflection.entryPoints[${index}].bindings[${refIndex}]`, `duplicate binding reference ${key}`);
      used.add(key);
    }
    const locations = /* @__PURE__ */ new Set();
    for (const [inputIndex, input] of (entry.inputs ?? []).entries()) {
      if (locations.has(input.location))
        fail(`reflection.entryPoints[${index}].inputs[${inputIndex}].location`, `duplicate vertex input location ${input.location}`);
      locations.add(input.location);
    }
    const pairs = /* @__PURE__ */ new Set();
    for (const [pairIndex, pair] of (entry.samplingPairs ?? []).entries()) {
      const textureKey = bindingKey(pair.texture);
      const samplerKey = bindingKey(pair.sampler);
      const texture = coordinates.get(textureKey);
      const sampler2 = coordinates.get(samplerKey);
      if (!used.has(textureKey) || !texture)
        fail(`reflection.entryPoints[${index}].samplingPairs[${pairIndex}].texture`, `dangling or inactive texture reference ${textureKey}`);
      if (!used.has(samplerKey) || !sampler2)
        fail(`reflection.entryPoints[${index}].samplingPairs[${pairIndex}].sampler`, `dangling or inactive sampler reference ${samplerKey}`);
      if (texture.bindingLayout?.kind !== "texture" && texture.bindingLayout?.kind !== "externalTexture")
        fail(`reflection.entryPoints[${index}].samplingPairs[${pairIndex}].texture`, "reference is not a sampled texture");
      if (sampler2.bindingLayout?.kind !== "sampler")
        fail(`reflection.entryPoints[${index}].samplingPairs[${pairIndex}].sampler`, "reference is not a sampler");
      if (pair.mode === "comparison" !== (sampler2.bindingLayout.sampler.type === "comparison"))
        fail(`reflection.entryPoints[${index}].samplingPairs[${pairIndex}].mode`, "does not match the referenced sampler type");
      const key = `${textureKey}|${samplerKey}|${pair.mode}`;
      if (pairs.has(key))
        fail(`reflection.entryPoints[${index}].samplingPairs[${pairIndex}]`, "duplicate sampling relationship");
      pairs.add(key);
    }
  }
  const structs = /* @__PURE__ */ new Map();
  for (const item of reflection.structs) {
    structs.set(item.name, item);
    structs.set(item.mangledName, item);
  }
  const aliases = /* @__PURE__ */ new Map();
  for (const item of reflection.aliases) {
    aliases.set(item.name, item);
    aliases.set(item.mangledName, item);
  }
  forEachType(reflection, (type, path) => {
    if (type.kind === "identifier" && !structs.has(type.mangledName ?? type.name) && !aliases.has(type.mangledName ?? type.name))
      fail(path, `unknown type reference '${type.mangledName ?? type.name}'`);
  });
  for (const [index, binding] of reflection.bindings.entries()) {
    const bindingPath = `reflection.bindings[${index}]`;
    const resolvedBindingType = resolveType(binding.type, structs, aliases, /* @__PURE__ */ new Set(), `${bindingPath}.type`);
    if (binding.struct) {
      const canonical = structs.get(binding.struct.mangledName) ?? structs.get(binding.struct.name);
      if (!canonical || !dataEqual(canonical, binding.struct))
        fail(`${bindingPath}.struct`, "does not match a canonical reflected struct");
      const typeStruct = resolvedBindingType.kind === "identifier" ? structs.get(resolvedBindingType.mangledName ?? resolvedBindingType.name) : void 0;
      if (!typeStruct || !dataEqual(typeStruct, binding.struct))
        fail(`${bindingPath}.struct`, "does not match the alias-resolved binding type");
    }
    if (binding.layout) {
      if (binding.layout.name !== binding.name || binding.layout.mangledName !== binding.mangledName)
        fail(`${bindingPath}.layout`, "does not belong to the binding identity");
      const canonical = reflection.hostShareableLayouts.find((layout) => layout.name === binding.layout.name && layout.mangledName === binding.layout.mangledName);
      if (!canonical || !dataEqual(canonical, binding.layout))
        fail(`${bindingPath}.layout`, "does not match a canonical host-shareable layout");
      if (!dataEqual(resolvedBindingType, binding.layout.type))
        fail(`${bindingPath}.layout.type`, "does not match the alias-resolved binding type");
      if (binding.bindingLayout?.kind === "buffer" && binding.bindingLayout.buffer.minBindingSize !== binding.layout.size)
        fail(`${bindingPath}.bindingLayout.buffer.minBindingSize`, "does not match the host-shareable layout size");
    }
  }
  reflection.hostShareableLayouts.forEach((layout, index) => validateLayoutReferences(layout, `reflection.hostShareableLayouts[${index}]`, structs, aliases));
}
function validateLayout(layout, path) {
  const composite = layout.element !== void 0 || layout.stride !== void 0 || layout.members !== void 0;
  if (layout.stride !== void 0) {
    if (!layout.element)
      fail(`${path}.element`, "stride requires element metadata");
    if (layout.stride % layout.element.align !== 0)
      fail(`${path}.stride`, "must be aligned to the element alignment");
    if (layout.element.size !== void 0 && layout.stride < layout.element.size)
      fail(`${path}.stride`, "must not be smaller than the element size");
  }
  if (layout.runtimeSized && (layout.type.kind !== "array" || layout.type.count !== void 0 || layout.size !== void 0 || !layout.element || layout.stride === void 0))
    fail(`${path}.runtimeSized`, "is inconsistent with runtime-sized array metadata");
  if (layout.type.kind === "array" || layout.type.kind === "matrix") {
    if (!layout.element || layout.stride === void 0)
      fail(path, `${layout.type.kind} layout requires element and stride metadata`);
    if (layout.type.kind === "array" && layout.type.count !== void 0 && layout.size !== layout.stride * layout.type.count)
      fail(`${path}.size`, "does not match array count and stride");
  }
  switch (layout.type.kind) {
    case "scalar": {
      if (layout.type.name === "bool")
        fail(`${path}.type`, "bool is not host-shareable");
      const size = layout.type.name === "f16" ? 2 : 4;
      validateLeafLayout(layout, path, size, size, composite);
      break;
    }
    case "atomic":
      if (layout.type.element.kind !== "scalar" || layout.type.element.name !== "i32" && layout.type.element.name !== "u32")
        fail(`${path}.type.element`, "atomic layout requires i32 or u32 scalar storage");
      validateLeafLayout(layout, path, 4, 4, composite);
      break;
    case "vector": {
      const scalar = layout.type.element;
      if (scalar.kind !== "scalar" || scalar.name === "bool")
        fail(`${path}.type.element`, "vector layout requires a numeric scalar");
      const scalarSize = scalar.name === "f16" ? 2 : 4;
      validateLeafLayout(layout, path, layout.type.width === 2 ? scalarSize * 2 : scalarSize * 4, scalarSize * layout.type.width, composite);
      break;
    }
    case "matrix": {
      const scalar = layout.type.element;
      if (scalar.kind !== "scalar" || scalar.name !== "f32" && scalar.name !== "f16")
        fail(`${path}.type.element`, "matrix layout requires an f32 or f16 scalar");
      if (!layout.element || layout.element.type.kind !== "vector" || layout.element.type.width !== layout.type.rows || !dataEqual(layout.element.type.element, scalar))
        fail(`${path}.element.type`, "does not match the matrix column vector");
      const expectedStride = roundUp(layout.element.align, requiredLayoutSize(layout.element, `${path}.element`));
      if (layout.align !== layout.element.align)
        fail(`${path}.align`, "does not match the matrix column alignment");
      if (layout.stride !== expectedStride)
        fail(`${path}.stride`, "does not match the matrix column stride");
      if (layout.size !== expectedStride * layout.type.columns)
        fail(`${path}.size`, "does not match matrix columns and stride");
      if (layout.members)
        fail(`${path}.members`, "matrix layouts cannot contain struct members");
      break;
    }
    case "array": {
      if (!layout.element || !dataEqual(layout.element.type, layout.type.element))
        fail(`${path}.element.type`, "does not match the array element type");
      const expectedStride = roundUp(layout.element.align, requiredLayoutSize(layout.element, `${path}.element`));
      if (layout.align !== layout.element.align)
        fail(`${path}.align`, "does not match the array element alignment");
      if (layout.stride !== expectedStride)
        fail(`${path}.stride`, "does not match the array element stride");
      if (layout.runtimeSized !== (layout.type.count === void 0))
        fail(`${path}.runtimeSized`, "does not match the array count");
      if (layout.members)
        fail(`${path}.members`, "array layouts cannot contain struct members");
      break;
    }
    case "identifier":
      if (!layout.members || layout.element || layout.stride !== void 0 || layout.runtimeSized !== void 0)
        fail(path, "struct layout shape is incomplete or contains array metadata");
      break;
    default:
      fail(`${path}.type`, `type '${layout.type.kind}' cannot have a host-shareable layout`);
  }
  if (!layout.members)
    return;
  let end = 0;
  let maxAlign = 1;
  for (const [index, member] of layout.members.entries()) {
    const memberPath = `${path}.members[${index}]`;
    const expectedAlign = Math.max(member.layout.align, member.explicitAlign ?? 1);
    const expectedSize = Math.max(member.layout.size ?? 0, member.explicitSize ?? 0);
    if (member.align !== expectedAlign)
      fail(`${memberPath}.align`, "does not match intrinsic/explicit alignment");
    if (member.size !== expectedSize)
      fail(`${memberPath}.size`, "does not match intrinsic/explicit size");
    const expectedOffset = roundUp(member.align, end);
    if (member.offset !== expectedOffset)
      fail(`${memberPath}.offset`, "does not match the aligned preceding bound");
    end = member.offset + (member.size ?? 0);
    if (member.layout.runtimeSized && index !== layout.members.length - 1)
      fail(memberPath, "runtime-sized arrays must be the final member");
    maxAlign = Math.max(maxAlign, member.align);
  }
  if (layout.align !== maxAlign)
    fail(`${path}.align`, "does not match the maximum member alignment");
  if (layout.size !== roundUp(maxAlign, end))
    fail(`${path}.size`, "does not match the rounded containing bound");
}
function validateLayoutReferences(layout, path, structs, aliases) {
  const resolved = resolveType(layout.type, structs, aliases, /* @__PURE__ */ new Set(), `${path}.type`);
  if (resolved.kind === "identifier") {
    const struct = structs.get(resolved.mangledName ?? resolved.name);
    if (!struct)
      fail(`${path}.type`, `unknown struct '${resolved.mangledName ?? resolved.name}'`);
    if (!layout.members || layout.members.length !== struct.members.length)
      fail(`${path}.members`, "does not match the canonical struct member count");
    for (let index = 0; index < struct.members.length; index++) {
      const canonical = struct.members[index];
      const member = layout.members[index];
      if (member.name !== canonical.name || !dataEqual(member.type, canonical.type))
        fail(`${path}.members[${index}]`, "does not match the canonical struct member");
      if (member.explicitAlign !== canonical.align)
        fail(`${path}.members[${index}].explicitAlign`, "does not match the canonical struct member align attribute");
      if (member.explicitSize !== canonical.size)
        fail(`${path}.members[${index}].explicitSize`, "does not match the canonical struct member size attribute");
      const expectedType = resolveType(canonical.type, structs, aliases, /* @__PURE__ */ new Set(), `${path}.members[${index}].type`);
      if (!dataEqual(expectedType, member.layout.type))
        fail(`${path}.members[${index}].layout.type`, "does not match the resolved member type");
    }
  }
  layout.members?.forEach((member, index) => validateLayoutReferences(member.layout, `${path}.members[${index}].layout`, structs, aliases));
  if (layout.element)
    validateLayoutReferences(layout.element, `${path}.element`, structs, aliases);
}
function resolveType(type, structs, aliases, resolving, path) {
  switch (type.kind) {
    case "identifier": {
      const key = type.mangledName ?? type.name;
      if (structs.has(key))
        return type;
      const alias = aliases.get(key);
      if (!alias)
        fail(path, `unknown type reference '${key}'`);
      if (resolving.has(key))
        fail(path, `cyclic alias reference '${key}'`);
      resolving.add(key);
      try {
        return resolveType(alias.target, structs, aliases, resolving, path);
      } finally {
        resolving.delete(key);
      }
    }
    case "array":
    case "atomic":
    case "vector":
    case "matrix":
    case "ptr":
      return { ...type, element: resolveType(type.element, structs, aliases, resolving, `${path}.element`) };
    case "texture":
      return { ...type, ...type.sampleType ? { sampleType: resolveType(type.sampleType, structs, aliases, resolving, `${path}.sampleType`) } : {} };
    default:
      return type;
  }
}
function validateLeafLayout(layout, path, expectedAlign, expectedSize, composite) {
  if (layout.align !== expectedAlign)
    fail(`${path}.align`, `expected intrinsic alignment ${expectedAlign}`);
  if (layout.size !== expectedSize)
    fail(`${path}.size`, `expected intrinsic size ${expectedSize}`);
  if (composite || layout.runtimeSized !== void 0)
    fail(path, "leaf layout contains composite metadata");
}
function requiredLayoutSize(layout, path) {
  if (layout.size === void 0)
    fail(`${path}.size`, "element layout must have a fixed size");
  return layout.size;
}
function roundUp(align2, value) {
  return Math.ceil(value / align2) * align2;
}
function forEachType(reflection, visit) {
  const walk = (type, path) => {
    visit(type, path);
    if ("element" in type)
      walk(type.element, `${path}.element`);
    if (type.kind === "texture" && type.sampleType)
      walk(type.sampleType, `${path}.sampleType`);
  };
  reflection.bindings.forEach((binding, index) => walk(binding.type, `reflection.bindings[${index}].type`));
  reflection.entryPoints.forEach((entry, index) => entry.inputs?.forEach((input, inputIndex) => walk(input.type, `reflection.entryPoints[${index}].inputs[${inputIndex}].type`)));
  reflection.aliases.forEach((alias, index) => walk(alias.target, `reflection.aliases[${index}].target`));
  reflection.structs.forEach((struct, index) => struct.members.forEach((member, memberIndex) => walk(member.type, `reflection.structs[${index}].members[${memberIndex}].type`)));
  const walkLayout = (layout, path) => {
    walk(layout.type, `${path}.type`);
    layout.members?.forEach((member, index) => {
      walk(member.type, `${path}.members[${index}].type`);
      walkLayout(member.layout, `${path}.members[${index}].layout`);
    });
    if (layout.element)
      walkLayout(layout.element, `${path}.element`);
  };
  reflection.hostShareableLayouts.forEach((layout, index) => walkLayout(layout, `reflection.hostShareableLayouts[${index}]`));
}
function uniqueIdentities(items, path) {
  const names = /* @__PURE__ */ new Set();
  const mangled = /* @__PURE__ */ new Set();
  for (const [index, item] of items.entries()) {
    if (names.has(item.name))
      fail(`${path}[${index}].name`, `duplicate identity '${item.name}'`);
    if (mangled.has(item.mangledName))
      fail(`${path}[${index}].mangledName`, `duplicate identity '${item.mangledName}'`);
    names.add(item.name);
    mangled.add(item.mangledName);
  }
}
function uniqueStrings(items, path) {
  const values = /* @__PURE__ */ new Set();
  for (const [index, item] of items.entries()) {
    if (values.has(item))
      fail(`${path}[${index}]`, `duplicate value '${item}'`);
    values.add(item);
  }
}
function bindingKey(value) {
  return `${value.group}:${value.binding}`;
}
function dataEqual(a, b) {
  if (Object.is(a, b))
    return true;
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null)
    return false;
  if (Array.isArray(a) || Array.isArray(b))
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => dataEqual(value, b[index]));
  const aEntries = Object.entries(a);
  const bEntries = Object.entries(b);
  return aEntries.length === bEntries.length && aEntries.every(([key, value]) => Object.hasOwn(b, key) && dataEqual(value, b[key]));
}
function cloneArray(value, path, clone) {
  if (!Array.isArray(value))
    fail(path, "expected an array");
  noteFrozen(value);
  return withActive(value, path, () => {
    const result = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = descriptorOf(value, String(index), `${path}[${index}]`);
      if (!descriptor)
        fail(`${path}[${index}]`, "sparse arrays are not allowed");
      if (!("value" in descriptor))
        fail(`${path}[${index}]`, "accessor array elements are not allowed");
      result.push(clone(descriptor.value, `${path}[${index}]`));
    }
    return result;
  });
}
function withRecord(value, path, build) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail(path, "expected a plain data object");
  noteFrozen(value);
  let prototype;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    return fail(path, "could not inspect object prototype");
  }
  if (prototype !== Object.prototype && prototype !== null)
    fail(path, "expected a plain data object");
  return withActive(value, path, () => build(value));
}
function withActive(value, path, build) {
  if (active.has(value))
    fail(path, "cyclic metadata is not allowed");
  active.add(value);
  try {
    return build();
  } finally {
    active.delete(value);
  }
}
function required(object, key, path) {
  const descriptor = descriptorOf(object, key, path);
  if (!descriptor)
    fail(path, "missing required own data property");
  if (!("value" in descriptor))
    fail(path, "accessor properties are not allowed");
  if (descriptor.value === void 0)
    fail(path, "undefined is not JSON-compatible");
  return descriptor.value;
}
function optional(object, key, path) {
  const descriptor = descriptorOf(object, key, path);
  if (!descriptor)
    return { present: false };
  if (!("value" in descriptor))
    fail(path, "accessor properties are not allowed");
  if (descriptor.value === void 0)
    fail(path, "optional undefined properties must be omitted");
  return { present: true, value: descriptor.value };
}
function descriptorOf(object, key, path) {
  try {
    return Object.getOwnPropertyDescriptor(object, key);
  } catch {
    return fail(path, "could not read its own property descriptor");
  }
}
function stringField(object, key, path, allowEmpty = false) {
  const value = required(object, key, path);
  if (allowEmpty && typeof value === "string")
    return value;
  return nonemptyString(value, path);
}
function cloneNonemptyString(value, path) {
  return nonemptyString(value, path);
}
function nonemptyString(value, path) {
  if (typeof value !== "string" || value.length === 0)
    fail(path, "expected a nonempty string");
  return value;
}
function finiteNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value))
    fail(path, "expected a finite number or 'unresolved'");
  return value;
}
function nonnegativeInteger(value, path) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    fail(path, "expected a non-negative safe integer");
  return value;
}
function positiveInteger2(value, path) {
  const result = nonnegativeInteger(value, path);
  if (result === 0)
    fail(path, "expected a positive integer");
  return result;
}
function positivePowerOfTwo(value, path) {
  const result = positiveInteger2(value, path);
  if (!Number.isInteger(Math.log2(result)))
    fail(path, "expected a positive power of two");
  return result;
}
function booleanValue(value, path) {
  if (typeof value !== "boolean")
    fail(path, "expected a boolean");
  return value;
}
function oneOf(value, path, choices) {
  if (!choices.includes(value))
    fail(path, `expected one of ${choices.map(String).join(", ")}`);
  return value;
}
function fail(path, reason) {
  throw invalidShaderSourceError(path, reason);
}

// node_modules/vgpu/dist/shader-source-checksum.js
var OFFSET_BASIS = 0xcbf29ce484222325n;
var PRIME = 0x100000001b3n;
var MASK_64 = 0xffffffffffffffffn;
function shaderSourceChecksum(source) {
  let hash = OFFSET_BASIS;
  for (let index = 0; index < source.length; index++) {
    const codeUnit = source.charCodeAt(index);
    hash = update(hash, codeUnit & 255);
    hash = update(hash, codeUnit >>> 8);
  }
  return `fnv1a64-utf16le-v1:${hash.toString(16).padStart(16, "0")}`;
}
function update(hash, byte) {
  return (hash ^ BigInt(byte)) * PRIME & MASK_64;
}

// node_modules/vgpu/dist/shader-source.js
var artifacts = /* @__PURE__ */ new WeakMap();
function snapshotShaderSource(input) {
  if (typeof input === "string")
    throw unpreparedShaderSourceError();
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw invalidShaderSourceError("shader", "expected a prepared ShaderSource object");
  }
  let known = artifacts.get(input);
  if (known?.snapshot)
    return known.snapshot;
  const rootFrozen = isProvenFrozen(input);
  const version = ownData(input, "version");
  if (version === 1)
    throw unpreparedShaderSourceError();
  if (typeof version === "number" && Number.isInteger(version) && version !== 2) {
    throw unsupportedShaderSourceVersionError(version, optionalOwnString(input, "producer"));
  }
  if (version !== 2)
    throw invalidShaderSourceError("version", "expected integer artifact version 2");
  const [data, graphFrozen] = clonePreparedShaderData(input);
  if (!/^fnv1a64-utf16le-v1:[0-9a-f]{16}$/.test(data.sourceChecksum)) {
    throw invalidShaderSourceError("sourceChecksum", "expected fnv1a64-utf16le-v1 followed by 16 lowercase hexadecimal digits");
  }
  if (known?.wgsl !== data.wgsl)
    artifacts.set(input, known = { wgsl: data.wgsl, checksum: shaderSourceChecksum(data.wgsl) });
  if (data.sourceChecksum !== known.checksum) {
    throw invalidShaderSourceError("sourceChecksum", "checksum does not match wgsl");
  }
  const snapshot = deepFreeze({
    wgsl: data.wgsl,
    reflection: data.reflection,
    ...data.functionExports !== void 0 ? { functionExports: data.functionExports } : {}
  });
  if (rootFrozen && graphFrozen)
    known.snapshot = snapshot;
  return snapshot;
}
function ownData(object, key) {
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(object, key);
  } catch {
    throw invalidShaderSourceError(key, "could not read its own property descriptor");
  }
  if (!descriptor)
    throw invalidShaderSourceError(key, "missing required own data property");
  if (!("value" in descriptor))
    throw invalidShaderSourceError(key, "accessor properties are not allowed");
  return descriptor.value;
}
function optionalOwnString(object, key) {
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(object, key);
  } catch {
    return void 0;
  }
  return descriptor && "value" in descriptor && typeof descriptor.value === "string" && descriptor.value.length > 0 ? descriptor.value : void 0;
}
function deepFreeze(value) {
  if (typeof value !== "object" || value === null || Object.isFrozen(value))
    return value;
  for (const nested of Object.values(value))
    deepFreeze(nested);
  return Object.freeze(value);
}

// node_modules/vgpu/dist/draw.js
var nextDrawId = 1;
var drawStates = /* @__PURE__ */ new WeakMap();
var noCleanupFailure2 = /* @__PURE__ */ Symbol("no cleanup failure");
var InternalDraw = class {
  label;
  #dynamicBindGroupLayouts = /* @__PURE__ */ new Map();
  constructor(device, shader, opts, cache = createBindGroupCache(), defaultTarget, pipelineStore = createPipelineStore(device), shaderModules = createShaderModuleCache(device), pipelineLayouts = createPipelineLayoutCache(device), errorSink, trackSettled, builtinVertexStage) {
    assertDeviceUsable(device, "Draw.constructor");
    this.label = opts.label ?? "draw";
    const id = nextDrawId++;
    const reflection = shader.reflection;
    const entryNames = normalizeEntryOptions(this.label, opts.entry);
    const vertexEntry = builtinVertexStage?.entry ?? selectEntryPoint(this.label, reflection.entryPoints, "vertex", entryNames.vertex, "draw");
    const fragmentEntry = selectEntryPoint(this.label, reflection.entryPoints, "fragment", entryNames.fragment, "draw");
    const entryKey = entryKeyFor(vertexEntry, fragmentEntry);
    const selectedEntries = [vertexEntry, fragmentEntry].filter((entry) => !!entry);
    const visibility = visibilityForEntries(reflection.bindings, selectedEntries);
    validateStorageStageLimits(device, this.label, reflection.bindings, selectedEntries, visibility);
    const geometry = opts.geometry;
    const inputs = vertexEntry ? entryMetadata(vertexEntry, "inputs", this.label) : [];
    const vertexBufferLayouts = geometry && geometryLayoutResolver in geometry ? geometry[geometryLayoutResolver](inputs, `${this.label}.geometry`) : geometry?.vertexBufferLayouts;
    const bindGroupLayouts = new Map(bindGroupLayoutsForReflection(device, this.label, reflection, visibility));
    const pipelineLayout = pipelineLayouts.get(bindGroupLayouts);
    const fragmentShaderModule = shaderModules.get(shader.wgsl, `${this.label}.shader`);
    const vertexShaderModule = builtinVertexStage ? shaderModules.get(builtinVertexStage.source, `${this.label}.fullscreen.shader`) : fragmentShaderModule;
    const recordedIn = createBundleRegistry();
    const lifecycle = { label: this.label, recordedIn };
    const fragmentState = normalizeFragmentState(this.label, opts);
    const blendConstantOptions = normalizeBlendConstantOptions(this.label, opts, fragmentState);
    const primitiveOptions = normalizePrimitiveOptions(device, this.label, opts);
    const depthOptions = normalizeDepthOptions(device, this.label, opts);
    const stencilOptions = normalizeStencilOptions(this.label, opts);
    const multisampleOptions = normalizeMultisampleOptions(this.label, opts);
    const constantsOptions = normalizeConstantsOptions(this.label, opts.constants, reflection.overrides, "draw");
    const disposedLabel = this.label;
    const setCore = createSetCore({
      device,
      label: this.label,
      reflection,
      bindGroupLayouts,
      cache,
      disposedError: (operation) => drawDisposedError(disposedLabel, operation)
    });
    const { set: initialSet, ...retainedOpts } = opts;
    drawStates.set(this, { id, device, opts: retainedOpts, vertexBufferLayouts, cache, defaultTarget, reflection, visibility, vertexEntry: vertexEntry?.name ?? "vs_main", fragmentEntry: fragmentEntry?.name ?? "fs_main", entryKey, setCore, bindGroupLayouts, pipelineLayout, vertexShaderModule, fragmentShaderModule, pipelineStore, pipelineLayouts, errorSink, trackSettled, resolvedPipelineKeys: /* @__PURE__ */ new Set(), pipelineKeys: !vertexBufferLayouts || geometryLayoutResolver in geometry ? /* @__PURE__ */ new WeakMap() : void 0, pipelineKeyDerivations: 0, lifecycle, ...fragmentState, ...blendConstantOptions, ...primitiveOptions, ...depthOptions, ...stencilOptions, ...multisampleOptions, ...constantsOptions });
    if (initialSet)
      this.set(initialSet);
    for (const target2 of opts.targets ?? [])
      this.compileSync(target2);
  }
  get gpu() {
    const state = drawState(this, "gpu");
    for (const key of state.resolvedPipelineKeys) {
      const pipeline = state.pipelineStore.getReady(key);
      if (pipeline)
        return pipeline;
    }
    return void 0;
  }
  get targets() {
    return drawState(this, "targets").opts.targets;
  }
  dispose() {
    const state = drawStateRecord(this);
    if ("disposed" in state)
      return;
    drawStates.set(this, { disposed: true, label: this.label });
    let failure = noCleanupFailure2;
    try {
      state.lifecycle.recordedIn.markStale({ kind: "draw-disposed", drawLabel: state.lifecycle.label });
    } catch (error) {
      failure = error;
    }
    this.#dynamicBindGroupLayouts.clear();
    try {
      state.setCore.dispose();
    } catch (error) {
      if (failure === noCleanupFailure2)
        failure = error;
    }
    if (failure !== noCleanupFailure2)
      throw failure;
  }
  assertUsable(operation) {
    drawState(this, operation);
  }
  /**
   * Frame drawable protocol: a `Frame` encodes through this instead of importing draw.ts, so a
   * program that never draws never pulls this module. The instance is its own protocol object —
   * `encode`, `label` and the depth/stencil metadata below are exactly what a pass needs.
   */
  get [FRAME_DRAWABLE]() {
    drawState(this, "drawable");
    return this;
  }
  /** @internal Frame drawable protocol; see {@link drawWritesDepth}. */
  writesDepth() {
    return drawWritesDepth(this);
  }
  /** @internal Frame drawable protocol; see {@link drawStencilWritingOps}. */
  stencilWritingOps() {
    return drawStencilWritingOps(this);
  }
  set(values) {
    const state = drawState(this, "set");
    assertDeviceUsable(state.device, `${this.label}.set`);
    for (const change of state.setCore.set(values))
      state.lifecycle.recordedIn.markStale({ kind: "binding-identity", drawLabel: state.lifecycle.label, ...change });
    return this;
  }
  group(n, bindGroup) {
    const state = drawState(this, "group");
    assertDeviceUsable(state.device, `${this.label}.group`);
    const expectedLayout = this.#dynamicBindGroupLayouts.get(n) ?? this.layout(n);
    const previousIdentity = state.setCore.claimGroup(n, bindGroup, expectedLayout);
    state.lifecycle.recordedIn.markStale({ kind: "group-claim", drawLabel: state.lifecycle.label, group: n, previousIdentity, newIdentity: `claimed-group:${n}` });
    return this;
  }
  layout(n, opts = {}) {
    const state = drawState(this, "layout");
    assertDeviceUsable(state.device, `${this.label}.layout`);
    if (!opts.dynamicOffsets)
      return state.setCore.layout(n);
    return this.#dynamicLayout(n);
  }
  #dynamicLayout(group) {
    const state = drawState(this);
    state.setCore.layout(group);
    const existing = this.#dynamicBindGroupLayouts.get(group);
    if (existing)
      return existing;
    const entries = dynamicEntries(this, group);
    const layout = cachedBindGroupLayout(state.device, `${this.label}.group${group}.dynamic.bgl`, entries);
    this.#dynamicBindGroupLayouts.set(group, layout);
    state.bindGroupLayouts.set(group, layout);
    state.setCore.refreshLayouts();
    state.pipelineLayout = state.pipelineLayouts.get(state.bindGroupLayouts);
    return layout;
  }
  /**
   * Encodes and submits this draw as a one-shot render pass.
   *
   * Raw claimed-bind-group validation failures are delivered asynchronously via
   * `gpu.onError` as `VGPU-R4-GROUP-VALIDATION`.
   */
  draw(arg = {}) {
    const live = drawState(this, "draw");
    assertDeviceUsable(live.device, `${this.label}.draw`);
    const opts = isTarget(arg) ? { target: arg } : arg;
    const state = drawState(this, "draw");
    const target2 = opts.target ?? state.defaultTarget;
    if (!target2)
      throw targetRequiredError(`${this.label}.draw`);
    assertSurfaceTargetInFrame(target2, `${this.label}.draw`);
    state.setCore.preflight();
    const encoder = state.device.gpu.createCommandEncoder();
    const pass = encoder.beginRenderPass(target2.renderPassDescriptor());
    const validations2 = [];
    try {
      this.encode(pass, target2, opts, (result) => validations2.push(result));
    } catch (error) {
      discardClaimedGroupValidationResults(validations2);
      discardClaimedGroupValidationScopes(state.device);
      try {
        pass.end();
      } catch {
      }
      throw error;
    }
    endRenderPassWithClaimValidation(state.device, pass, validations2, validations2[0]?.context);
    let commandBuffer;
    const finishContext = validations2[0]?.context;
    if (finishContext)
      pushClaimedGroupValidationScope(state.device, finishContext);
    try {
      commandBuffer = encoder.finish();
    } catch (error) {
      const result = finishContext ? popLastClaimedGroupValidationScope(state.device) : void 0;
      discardClaimedGroupValidationResults(validations2);
      if (result)
        discardClaimedGroupValidationResults([result]);
      const context = result?.context ?? finishContext;
      if (context) {
        void reportDrawValidationError(state, context.label, context.group, error);
        return;
      }
      throw error;
    }
    if (finishContext) {
      const result = popLastClaimedGroupValidationScope(state.device);
      if (result)
        validations2[0] = validations2[0] ? preferClaimedGroupValidationResult(result, validations2[0]) : result;
    }
    const submitContext = validations2[0]?.context;
    if (submitContext)
      pushClaimedGroupValidationScope(state.device, submitContext);
    try {
      state.device.gpu.queue.submit([commandBuffer]);
    } catch (error) {
      const result = submitContext ? popLastClaimedGroupValidationScope(state.device) : void 0;
      discardClaimedGroupValidationResults(validations2);
      if (result)
        discardClaimedGroupValidationResults([result]);
      const context = result?.context ?? submitContext;
      if (context) {
        void reportDrawValidationError(state, context.label, context.group, error);
        return;
      }
      throw error;
    }
    if (submitContext) {
      const result = popLastClaimedGroupValidationScope(state.device);
      if (result)
        validations2[0] = validations2[0] ? preferClaimedGroupValidationResult(result, validations2[0]) : result;
    }
    if (validations2.length) {
      const done = claimedGroupValidationDone(state.device, validations2, { errorSink: state.errorSink });
      state.trackSettled?.(done);
    }
  }
  encode(pass, target2, opts = {}, claimValidation, capture) {
    const state = drawState(this, "encode");
    assertDeviceUsable(state.device, `${this.label}.encode`);
    state.setCore.preflight();
    const pipeline = this.pipelineFor(target2);
    if (!pipeline)
      return;
    pass.setPipeline(pipeline);
    if (state.blendConstant)
      pass.setBlendConstant(state.blendConstant);
    if (state.stencilRef !== void 0)
      pass.setStencilReference(state.stencilRef);
    for (const binding of state.setCore.bindGroups(capture))
      this.#setBindGroup(state, pass, binding, opts, claimValidation);
    this.#encodeGeometry(state, pass, opts);
  }
  #setBindGroup(state, pass, binding, opts, claimValidation) {
    const offsets = offsetsForGroup(opts.offsets, binding.group, binding.offsets);
    if (!binding.claimValidation || !claimValidation) {
      pass.setBindGroup(binding.group, binding.bindGroup, offsets);
      return;
    }
    pushClaimedGroupValidationScope(state.device, binding.claimValidation);
    try {
      pass.setBindGroup(binding.group, binding.bindGroup, offsets);
    } catch (error) {
      discardLastClaimedGroupValidationScope(state.device);
      throw claimedGroupNativeValidationError(binding.claimValidation.label, binding.claimValidation.group, error);
    }
    const result = popLastClaimedGroupValidationScope(state.device);
    if (result)
      claimValidation(result);
  }
  compile(target2) {
    return this.#pipelineAsync("compile", target2, () => this);
  }
  #pipelineAsync(method, target2, done) {
    const state = drawState(this, method);
    assertDeviceUsable(state.device, `${this.label}.${method}`);
    const { key, signature, signatureKey } = this.#compileKey(state, target2, method);
    const promise = state.pipelineStore.getAsync(key, () => state.device.gpu.createRenderPipelineAsync(this.#pipelineDescriptor(state, signature)), { where: `${this.label}.${method}`, signature: signatureKey, dependencies: pipelineDependencies(state) });
    return promise.then((pipeline) => {
      const current = drawState(this, method);
      assertDeviceUsable(current.device, `${this.label}.${method}`);
      current.resolvedPipelineKeys.add(key);
      return done(pipeline);
    }, (error) => {
      drawState(this, method);
      throw error;
    });
  }
  compileSync(target2) {
    this.#pipelineSync("compileSync", target2, true);
    return this;
  }
  pipelineFor(target2) {
    return this.#pipelineSync("pipelineFor", target2);
  }
  #pipelineSync(method, target2, retry) {
    const state = drawState(this, method);
    assertDeviceUsable(state.device, `${this.label}.${method}`);
    const { key, create, ctx } = this.#compileKey(state, target2, method);
    const pipeline = state.pipelineStore.getSync(key, create, retry ? { ...ctx, where: `${this.label}.${method}`, retry } : ctx);
    if (pipeline)
      state.resolvedPipelineKeys.add(key);
    return pipeline;
  }
  pipelineForAsync(target2) {
    return this.#pipelineAsync("pipelineForAsync", target2, (pipeline) => pipeline);
  }
  #compileKey(state, target2, method) {
    const resolved = target2 ?? state.defaultTarget;
    const geometry = state.opts.geometry;
    const memo = resolved && state.pipelineKeys?.get(resolved);
    if (memo && memo.pipelineLayout === state.pipelineLayout && memo.topology === geometry?.topology && memo.stripIndexFormat === stripIndexFormatFor(geometry) && sameSignature(resolved, memo.signature))
      return memo;
    state.pipelineKeyDerivations++;
    const signature = this.#signatureForKeyTarget(state, target2, `${this.label}.${method}`);
    const signatureKey = signatureKeyOf(signature);
    const next = {
      signature,
      signatureKey,
      key: this.#pipelineKey(state, signature),
      pipelineLayout: state.pipelineLayout,
      topology: geometry?.topology,
      stripIndexFormat: stripIndexFormatFor(geometry),
      create: () => state.device.gpu.createRenderPipeline(this.#pipelineDescriptor(state, signature)),
      ctx: { where: `${this.label}.pipelineFor`, signature: signatureKey, dependencies: pipelineDependencies(state) }
    };
    state.pipelineKeys?.set(resolved, next);
    return next;
  }
  #signatureForKeyTarget(state, target2, where) {
    const resolvedTarget = target2 ?? state.defaultTarget;
    if (!resolvedTarget)
      throw targetRequiredError(where);
    const signature = normalizeSignature(resolvedTarget);
    validateTargetSignature(signature, where);
    if (state.colorStates && state.colorStates.length !== signature.colors.length) {
      throw colorsInvalidError(this.label, `expected one entry per color attachment; colors has ${state.colorStates.length}, but the target signature has ${signature.colors.length}.`, where);
    }
    if (state.multisampleState?.alphaToCoverageEnabled && (signature.sampleCount ?? 1) <= 1) {
      throw multisampleInvalidError(this.label, `alphaToCoverage requires a multisampled target, but the target signature has sampleCount ${signature.sampleCount ?? 1}; create the target with msaa: true.`, where);
    }
    if ((state.stencilState || state.stencilRef !== void 0) && !hasStencilAspect(signature.depth)) {
      throw stencilInvalidError(this.label, `stencil requires a depth format with a stencil aspect, but the target signature has ${signature.depth ? `"${signature.depth}"` : "no depth"}; create the target with depth: "depth24plus-stencil8".`, where);
    }
    return signature;
  }
  #pipelineKey(state, signature) {
    const geometry = state.opts.geometry;
    return pipelineKeyOf({ vertexModule: state.vertexShaderModule, fragmentModule: state.fragmentShaderModule, pipelineLayout: state.pipelineLayout, vertexBufferLayouts: state.vertexBufferLayouts, signature, fragmentKey: state.fragmentKey, topology: geometry?.topology, stripIndexFormat: stripIndexFormatFor(geometry), cullMode: state.cullMode, frontFace: state.frontFace, unclippedDepth: state.unclippedDepth, depthKey: state.depthKey, stencilKey: state.stencilKey, multisampleKey: state.multisampleKey, constantsKey: state.constantsKey, entryKey: state.entryKey });
  }
  #encodeGeometry(state, pass, callOpts) {
    const geometry = state.opts.geometry;
    geometryLivenessOf(geometry)?.[geometryLiveness](`${this.label}.geometry`);
    if (geometry?.vertexBuffers)
      geometry.vertexBuffers.forEach((buffer, index) => pass.setVertexBuffer(index, buffer));
    if (callOpts.indirect !== void 0)
      return this.#encodeIndirect(pass, geometry, callOpts);
    const counts = resolveDrawCounts(this.label, geometry, state.opts, callOpts);
    if (!geometry?.indexBuffer)
      return pass.draw(counts.vertexCount, counts.instanceCount, counts.firstVertex, counts.firstInstance);
    pass.setIndexBuffer(geometry.indexBuffer, geometry.indexFormat ?? "uint32");
    pass.drawIndexed(counts.indexCount, counts.instanceCount, counts.firstIndex, counts.baseVertex, counts.firstInstance);
  }
  /**
   * The GPU reads the draw arguments from the buffer, so per-call counts alongside indirect are dead options and throw.
   * A non-zero firstInstance in the buffered arguments cannot be validated on the CPU; per WebGPU, it "must be 0,
   * unless the 'indirect-first-instance' feature is enabled", otherwise the indirect call "will be treated as a no-op".
   */
  #encodeIndirect(pass, geometry, callOpts) {
    const where = `${this.label}.draw`;
    const conflict = INDIRECT_CONFLICT_FIELDS.find((field) => callOpts[field] !== void 0);
    if (conflict !== void 0)
      throw indirectInvalidError(this.label, `indirect cannot be combined with ${conflict} in the same call; the GPU reads the draw arguments from the buffer, so the CPU-side value would be ignored.`, where);
    const indexed = !!geometry?.indexBuffer;
    const { buffer, offset } = resolveIndirect(this.label, where, callOpts.indirect, indexed ? "drawIndexedIndirect" : "drawIndirect");
    if (!indexed)
      return pass.drawIndirect(buffer, offset);
    pass.setIndexBuffer(geometry.indexBuffer, geometry.indexFormat ?? "uint32");
    pass.drawIndexedIndirect(buffer, offset);
  }
  #pipelineDescriptor(state, signature) {
    return {
      label: `${this.label}.pipeline`,
      layout: state.pipelineLayout,
      vertex: { module: state.vertexShaderModule, entryPoint: state.vertexEntry, buffers: [...state.vertexBufferLayouts ?? []], ...state.vertexShaderModule === state.fragmentShaderModule && state.constants ? { constants: state.constants } : {} },
      fragment: { module: state.fragmentShaderModule, entryPoint: state.fragmentEntry, targets: fragmentTargets(signature, state), ...state.constants ? { constants: state.constants } : {} },
      primitive: primitiveState(state.opts.geometry, state.cullMode, state.frontFace, state.unclippedDepth),
      depthStencil: depthStencilState(signature, state),
      multisample: multisampleStateFor(signature, state)
    };
  }
};
function validateStorageStageLimits(device, label, bindings, entries, visibility) {
  const limits = device.limits;
  for (const [stage, flag, limitName] of [["vertex", 1, "maxStorageBuffersInVertexStage"], ["fragment", 2, "maxStorageBuffersInFragmentStage"]]) {
    const entry = entries.find((item) => item.stage === stage);
    if (!entry)
      continue;
    const used = bindings.filter((binding) => binding.bindingLayout?.kind === "buffer" && binding.bindingLayout.buffer.type !== "uniform" && visibility(binding) & flag);
    const limit = limits[limitName] ?? limits.maxStorageBuffersPerShaderStage;
    if (limit !== void 0 && used.length > limit)
      throw storageStageLimitError(label, stage, entry.name, used.length, limit, used);
  }
}
var INDIRECT_CONFLICT_FIELDS = ["vertices", "indices", "instances", "firstVertex", "firstIndex", "baseVertex", "firstInstance"];
function fragmentTargets(signature, state) {
  return signature.colors.map((format, index) => {
    const overrides = state.colorStates?.[index];
    const blendState2 = overrides?.blendState ?? state.blendState;
    const writeMask = overrides?.writeMask ?? state.writeMask;
    const target2 = { format };
    if (blendState2)
      target2.blend = blendState2;
    if (writeMask !== void 0)
      target2.writeMask = writeMask;
    return target2;
  });
}
function resolveDrawCounts(label, geometry, drawOpts, callOpts) {
  validateOptionalDrawCount(label, "DrawOptions.instances", drawOpts.instances);
  validateOptionalDrawCount(label, "DrawOptions.vertices", drawOpts.vertices);
  validateOptionalDrawCount(label, "DrawOptions.firstInstance", drawOpts.firstInstance);
  validateOptionalDrawCount(label, "DrawCallOptions.instances", callOpts.instances);
  validateOptionalGeometryRange(label, "DrawCallOptions.vertices", callOpts.vertices);
  validateOptionalGeometryRange(label, "DrawCallOptions.indices", callOpts.indices);
  validateOptionalGeometryRange(label, "DrawCallOptions.firstVertex", callOpts.firstVertex);
  validateOptionalGeometryRange(label, "DrawCallOptions.firstIndex", callOpts.firstIndex);
  validateOptionalGeometryRange(label, "DrawCallOptions.baseVertex", callOpts.baseVertex);
  validateOptionalDrawCount(label, "DrawCallOptions.firstInstance", callOpts.firstInstance);
  validateOptionalDrawCount(label, "GeometryLike.vertexCount", geometry?.vertexCount);
  validateOptionalDrawCount(label, "GeometryLike.indexCount", geometry?.indexCount);
  validateOptionalDrawCount(label, "GeometryLike.instanceCount", geometry?.instanceCount);
  validateOptionalGeometryRange(label, "GeometryLike.firstVertex", geometry?.firstVertex);
  validateOptionalGeometryRange(label, "GeometryLike.firstIndex", geometry?.firstIndex);
  validateOptionalGeometryRange(label, "GeometryLike.baseVertex", geometry?.baseVertex);
  const indexed = !!geometry?.indexBuffer;
  const sliceParent = geometry?.geometry;
  const parent = sliceParent ?? (geometry && geometryLayoutResolver in geometry ? geometry : void 0);
  const firstVertex = callOpts.firstVertex ?? geometry?.firstVertex ?? 0;
  const vertexCount = callOpts.vertices ?? geometry?.vertexCount ?? drawOpts.vertices ?? 3;
  const firstIndex = callOpts.firstIndex ?? geometry?.firstIndex ?? 0;
  const indexCount = callOpts.indices ?? geometry?.indexCount ?? 0;
  const baseVertex = callOpts.baseVertex ?? geometry?.baseVertex ?? 0;
  if (indexed)
    validateDrawInterval(label, "index", firstIndex, indexCount, parent?.indexCount);
  else if (callOpts.indices !== void 0 || callOpts.firstIndex !== void 0 || callOpts.baseVertex !== void 0)
    throw meshRangeInvalidError(`${label}.draw`, "Index range needs an indexed geometry.");
  if (!indexed)
    validateDrawInterval(label, "vertex", firstVertex, vertexCount, parent?.vertexCount);
  return {
    instanceCount: callOpts.instances ?? drawOpts.instances ?? geometry?.instanceCount ?? 1,
    firstInstance: callOpts.firstInstance ?? drawOpts.firstInstance ?? 0,
    vertexCount,
    firstVertex,
    indexCount,
    firstIndex,
    baseVertex
  };
}
function sameSignature(target2, signature) {
  const configured = targetSignatureOf(target2);
  const source = configured ?? target2;
  const textures = !configured && isTarget(target2);
  const colors = source.colors;
  if (!Array.isArray(colors) || colors.length !== signature.colors.length)
    return false;
  for (let index = 0; index < colors.length; index++)
    if ((textures ? colors[index]?.format : colors[index]) !== signature.colors[index])
      return false;
  return (textures ? source.depth?.format : source.depth) === signature.depth && (textures ? source.sampleCount : source.sampleCount ?? 1) === signature.sampleCount;
}
function stripIndexFormatFor(geometry) {
  const topology = geometry?.topology ?? "triangle-list";
  return geometry?.stripIndexFormat ?? (topology.endsWith("strip") ? geometry?.indexFormat : void 0);
}
function primitiveState(geometry, cullMode, frontFace, unclippedDepth) {
  const topology = geometry?.topology ?? "triangle-list";
  const stripIndexFormat = stripIndexFormatFor(geometry);
  const state = stripIndexFormat ? { topology, stripIndexFormat } : { topology };
  if (cullMode !== void 0)
    state.cullMode = cullMode;
  if (frontFace !== void 0)
    state.frontFace = frontFace;
  if (unclippedDepth)
    state.unclippedDepth = true;
  return state;
}
function validateDrawInterval(label, kind, first, count, max) {
  if (max === void 0 || first + count <= max)
    return;
  throw meshRangeInvalidError(`${label}.draw`, `${kind} range [${first}, ${first + count}) exceeds parent geometry ${kind} count ${max}.`);
}
function validateOptionalGeometryRange(label, field, value) {
  if (value === void 0 || Number.isInteger(value) && value >= 0)
    return;
  throw meshRangeInvalidError(`${label}.draw`, `${field} must be an integer >= 0; received ${String(value)}.`);
}
function validateOptionalDrawCount(label, field, value) {
  if (value === void 0)
    return;
  if (Number.isInteger(value) && value >= 0)
    return;
  throw new VGPUError2({
    code: "VGPU-R1-DRAW-COUNT",
    message: `${field} of '${label}' must be an integer >= 0; received ${String(value)}. Use 0 only when you want to issue a valid draw with no vertices/instances.`,
    where: `${label}.draw`
  });
}
function normalizeFragmentState(label, opts) {
  const blendState2 = opts.blend === void 0 ? void 0 : normalizeBlend(label, opts.blend);
  const writeMask = opts.writeMask === void 0 ? void 0 : normalizeWriteMask(label, opts.writeMask);
  const colorStates = opts.colors === void 0 ? void 0 : normalizeColorStates(label, opts.colors);
  const fragmentKey = colorStates ? `${fragmentKeyFor(blendState2, writeMask)}@${colorStates.map(colorStateKeyFor).join("@")}` : blendState2 || writeMask !== void 0 ? fragmentKeyFor(blendState2, writeMask) : void 0;
  return { blendState: blendState2, writeMask, colorStates, fragmentKey };
}
function normalizeColorStates(label, value) {
  if (!Array.isArray(value))
    throw colorsInvalidError(label, `colors must be an array; received ${preview(value)}.`);
  return value.map((entry, index) => {
    if (entry === null || entry === void 0)
      return null;
    if (typeof entry !== "object" || Array.isArray(entry))
      throw colorsInvalidError(label, `colors[${index}] must be null or { blend?, writeMask? }; received ${preview(entry)}.`);
    const blendState2 = entry.blend === void 0 ? void 0 : normalizeBlend(`${label}.colors[${index}]`, entry.blend);
    const writeMask = entry.writeMask === void 0 ? void 0 : normalizeWriteMask(`${label}.colors[${index}]`, entry.writeMask);
    if (!blendState2 && writeMask === void 0)
      return null;
    return { blendState: blendState2, writeMask };
  });
}
function normalizeBlend(label, value) {
  if (value === "alpha")
    return blendState({ src: "src-alpha", dst: "one-minus-src-alpha" }, { src: "one", dst: "one-minus-src-alpha" });
  if (value === "premultiplied")
    return blendState({ src: "one", dst: "one-minus-src-alpha" }, { src: "one", dst: "one-minus-src-alpha" });
  if (value === "additive")
    return blendState({ src: "one", dst: "one" }, { src: "one", dst: "one" });
  if (typeof value !== "object" || value === null || !validBlendComponent(value.color))
    throw blendInvalidError(label, value);
  const color = value.color;
  const alpha = value.alpha;
  if (alpha !== void 0 && !validBlendComponent(alpha))
    throw blendInvalidError(label, value);
  return blendState(color, alpha ?? color);
}
function validBlendComponent(value) {
  return typeof value === "object" && value !== null && typeof value.src === "string" && typeof value.dst === "string";
}
function blendState(color, alpha) {
  return { color: blendComponent(color), alpha: blendComponent(alpha) };
}
function blendComponent(component) {
  return { srcFactor: component.src, dstFactor: component.dst, operation: component.op ?? "add" };
}
function normalizeBlendConstantOptions(label, opts, fragmentState) {
  if (opts.blendConstant === void 0)
    return {};
  const value = opts.blendConstant;
  if (!Array.isArray(value) || value.length !== 4 || value.some((component) => typeof component !== "number" || !Number.isFinite(component))) {
    throw blendConstantInvalidError(label, `received ${preview(value)}; expected [r, g, b, a] finite numbers.`);
  }
  if (!effectiveBlendStates(fragmentState).some((blend) => blend && usesConstantBlendFactor(blend))) {
    throw blendConstantInvalidError(label, `no color target's effective blend uses a "constant"/"one-minus-constant" factor (colors[i].blend replaces the top-level blend for that target), so blendConstant would have no effect.`);
  }
  return { blendConstant: { r: value[0], g: value[1], b: value[2], a: value[3] } };
}
function effectiveBlendStates(fragmentState) {
  if (!fragmentState.colorStates)
    return [fragmentState.blendState];
  return fragmentState.colorStates.map((entry) => entry?.blendState ?? fragmentState.blendState);
}
function usesConstantBlendFactor(blend) {
  return [blend.color.srcFactor, blend.color.dstFactor, blend.alpha.srcFactor, blend.alpha.dstFactor].some((factor) => factor === "constant" || factor === "one-minus-constant");
}
function normalizeEntryOptions(label, value) {
  if (value === void 0)
    return {};
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw entryInvalidError(label, `received ${preview(value)}; expected { vertex?, fragment? } entry point names.`);
  return value;
}
function entryKeyFor(vertexEntry, fragmentEntry) {
  return `en~${vertexEntry?.name ?? ""}~${fragmentEntry?.name ?? ""}`;
}
function pipelineDependencies(state) {
  return state.vertexShaderModule === state.fragmentShaderModule ? [state.vertexShaderModule, state.pipelineLayout] : [state.vertexShaderModule, state.fragmentShaderModule, state.pipelineLayout];
}
function normalizePrimitiveOptions(device, label, opts) {
  const cullMode = opts.cull === void 0 ? void 0 : normalizeCull(label, opts.cull);
  const frontFace = opts.frontFace === void 0 ? void 0 : normalizeFrontFace(label, opts.frontFace);
  const unclippedDepth = opts.unclippedDepth === void 0 ? void 0 : normalizeUnclippedDepth(device, label, opts.unclippedDepth);
  return { cullMode, frontFace, unclippedDepth };
}
function normalizeUnclippedDepth(device, label, value) {
  if (typeof value !== "boolean")
    throw unclippedDepthInvalidError(label, `received ${preview(value)}; expected a boolean.`);
  if (!value)
    return void 0;
  if (!device.features.has("depth-clip-control")) {
    throw unclippedDepthInvalidError(label, `the device lacks the "depth-clip-control" feature; request it at init: init({ requiredFeatures: ["depth-clip-control"] }) on an adapter that supports it.`);
  }
  return true;
}
function normalizeCull(label, value) {
  if (value === "none" || value === "front" || value === "back")
    return value;
  throw cullInvalidError(label, value);
}
function normalizeFrontFace(label, value) {
  if (value === "ccw" || value === "cw")
    return value;
  throw frontFaceInvalidError(label, value);
}
var DEFAULT_DEPTH_STATE = { depthWriteEnabled: true, depthCompare: "less-equal" };
var DEPTH_COMPARE_FUNCTIONS = ["never", "less", "equal", "less-equal", "greater", "not-equal", "greater-equal", "always"];
var I32_MIN = -2147483648;
var I32_MAX = 2147483647;
function depthStencilState(signature, state) {
  if (!signature.depth)
    return void 0;
  return { format: signature.depth, ...state.depthState ?? DEFAULT_DEPTH_STATE, ...state.stencilState ?? {} };
}
function normalizeDepthOptions(device, label, opts) {
  if (opts.depth === void 0)
    return {};
  const depthState = normalizeDepth(device, label, opts.depth, opts.geometry?.topology ?? "triangle-list");
  return { depthState, depthKey: depthKeyFor(depthState) };
}
function normalizeDepth(device, label, value, topology) {
  if (value === false)
    return { depthWriteEnabled: false, depthCompare: "always" };
  if (typeof value !== "object" || value === null)
    throw depthInvalidError(label, `received ${preview(value)}.`);
  if (value.write !== void 0 && typeof value.write !== "boolean")
    throw depthInvalidError(label, `write must be a boolean; received ${preview(value.write)}.`);
  if (value.compare !== void 0 && !DEPTH_COMPARE_FUNCTIONS.includes(value.compare))
    throw depthInvalidError(label, `compare must be a GPUCompareFunction; received ${preview(value.compare)}.`);
  if (value.bias !== void 0 && !Number.isInteger(value.bias))
    throw depthInvalidError(label, `bias must be an integer (WebGPU depthBias is i32); received ${preview(value.bias)}.`);
  if (value.bias !== void 0 && (value.bias < I32_MIN || value.bias > I32_MAX))
    throw depthInvalidError(label, `bias must fit in the i32 range [${I32_MIN}, ${I32_MAX}] (WebGPU depthBias is i32); received ${preview(value.bias)}.`);
  if (value.biasSlopeScale !== void 0 && !Number.isFinite(value.biasSlopeScale))
    throw depthInvalidError(label, `biasSlopeScale must be a finite number; received ${preview(value.biasSlopeScale)}.`);
  if (value.biasClamp !== void 0 && !Number.isFinite(value.biasClamp))
    throw depthInvalidError(label, `biasClamp must be a finite number; received ${preview(value.biasClamp)}.`);
  const bias = value.bias ?? 0;
  const biasSlopeScale = value.biasSlopeScale ?? 0;
  const biasClamp = value.biasClamp ?? 0;
  if ((bias !== 0 || biasSlopeScale !== 0 || biasClamp !== 0) && !topology.startsWith("triangle"))
    throw depthInvalidError(label, `bias, biasSlopeScale, and biasClamp must be 0 for "${topology}" topology.`);
  if (biasClamp !== 0 && device.isCompatibilityMode)
    throw depthInvalidError(label, `biasClamp must be 0 on a compatibility-mode device; received ${preview(value.biasClamp)}.`);
  return {
    depthWriteEnabled: value.write ?? true,
    depthCompare: value.compare ?? "less-equal",
    ...bias !== 0 ? { depthBias: bias } : {},
    ...biasSlopeScale !== 0 ? { depthBiasSlopeScale: biasSlopeScale } : {},
    ...biasClamp !== 0 ? { depthBiasClamp: biasClamp } : {}
  };
}
function depthKeyFor(state) {
  return `${state.depthWriteEnabled ? 1 : 0}~${state.depthCompare}~${state.depthBias ?? 0}~${state.depthBiasSlopeScale ?? 0}~${state.depthBiasClamp ?? 0}`;
}
var STENCIL_OPERATIONS = ["keep", "zero", "replace", "invert", "increment-clamp", "decrement-clamp", "increment-wrap", "decrement-wrap"];
function normalizeStencilOptions(label, opts) {
  if (opts.stencil === void 0)
    return {};
  const value = opts.stencil;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw stencilInvalidError(label, `received ${preview(value)}; expected { front?, back?, readMask?, writeMask?, ref? }.`);
  const front = value.front === void 0 ? void 0 : normalizeStencilFace(label, "front", value.front);
  const back = value.back === void 0 ? void 0 : normalizeStencilFace(label, "back", value.back);
  validateStencilValue(label, "readMask", value.readMask);
  validateStencilValue(label, "writeMask", value.writeMask);
  validateStencilValue(label, "ref", value.ref);
  const stencilState = {
    ...front ? { stencilFront: front } : {},
    // Omitted back mirrors the normalized front so both faces behave the same; with neither given, both keep the WebGPU defaults.
    ...back ?? front ? { stencilBack: back ?? { ...front } } : {},
    ...value.readMask !== void 0 ? { stencilReadMask: value.readMask } : {},
    ...value.writeMask !== void 0 ? { stencilWriteMask: value.writeMask } : {}
  };
  const hasPipelineState = stencilState.stencilFront !== void 0 || stencilState.stencilBack !== void 0 || stencilState.stencilReadMask !== void 0 || stencilState.stencilWriteMask !== void 0;
  if (!hasPipelineState && value.ref === void 0)
    return {};
  return {
    ...hasPipelineState ? { stencilState, stencilKey: stencilKeyFor(stencilState) } : {},
    // The reference is encoder state (setStencilReference), not pipeline state; it stays out of the pipeline key.
    ...value.ref !== void 0 ? { stencilRef: value.ref } : {}
  };
}
function normalizeStencilFace(label, field, value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw stencilInvalidError(label, `${field} must be a { compare?, fail?, depthFail?, pass? } object; received ${preview(value)}.`);
  if (value.compare !== void 0 && !DEPTH_COMPARE_FUNCTIONS.includes(value.compare))
    throw stencilInvalidError(label, `${field}.compare must be a GPUCompareFunction; received ${preview(value.compare)}.`);
  for (const [name, op] of [["fail", value.fail], ["depthFail", value.depthFail], ["pass", value.pass]]) {
    if (op !== void 0 && !STENCIL_OPERATIONS.includes(op))
      throw stencilInvalidError(label, `${field}.${name} must be a GPUStencilOperation; received ${preview(op)}.`);
  }
  return { compare: value.compare ?? "always", failOp: value.fail ?? "keep", depthFailOp: value.depthFail ?? "keep", passOp: value.pass ?? "keep" };
}
function validateStencilValue(label, field, value) {
  if (value === void 0)
    return;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 4294967295) {
    throw stencilInvalidError(label, `${field} must be an integer in [0, 0xFFFFFFFF] (WebGPU GPUStencilValue is u32); received ${preview(value)}.`);
  }
}
function stencilKeyFor(state) {
  return `st~${stencilFaceKeyFor(state.stencilFront)}~${stencilFaceKeyFor(state.stencilBack)}~${state.stencilReadMask ?? 4294967295}~${state.stencilWriteMask ?? 4294967295}`;
}
function stencilFaceKeyFor(face) {
  if (!face)
    return "default";
  return `${face.compare},${face.failOp},${face.depthFailOp},${face.passOp}`;
}
function multisampleStateFor(signature, state) {
  return { count: signature.sampleCount ?? 1, ...state.multisampleState ?? {} };
}
function normalizeMultisampleOptions(label, opts) {
  if (opts.multisample === void 0)
    return {};
  const value = opts.multisample;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw multisampleInvalidError(label, `received ${preview(value)}; expected { alphaToCoverage?, mask? }.`);
  if (value.alphaToCoverage !== void 0 && typeof value.alphaToCoverage !== "boolean")
    throw multisampleInvalidError(label, `alphaToCoverage must be a boolean; received ${preview(value.alphaToCoverage)}.`);
  if (value.mask !== void 0 && (typeof value.mask !== "number" || !Number.isInteger(value.mask) || value.mask < 0 || value.mask > 4294967295)) {
    throw multisampleInvalidError(label, `mask must be an integer in [0, 0xFFFFFFFF] (WebGPU GPUSampleMask is u32); received ${preview(value.mask)}.`);
  }
  const multisampleState = {
    ...value.alphaToCoverage !== void 0 ? { alphaToCoverageEnabled: value.alphaToCoverage } : {},
    ...value.mask !== void 0 ? { mask: value.mask } : {}
  };
  if (multisampleState.alphaToCoverageEnabled === void 0 && multisampleState.mask === void 0)
    return {};
  return { multisampleState, multisampleKey: multisampleKeyFor(multisampleState) };
}
function multisampleKeyFor(state) {
  return `ms~${state.alphaToCoverageEnabled ? 1 : 0}~${state.mask ?? 4294967295}`;
}
function normalizeWriteMask(label, value) {
  if (!Array.isArray(value))
    throw writeMaskInvalidError(label, preview(value));
  let mask = 0;
  for (const channel of value) {
    if (channel === "r")
      mask |= 1;
    else if (channel === "g")
      mask |= 2;
    else if (channel === "b")
      mask |= 4;
    else if (channel === "a")
      mask |= 8;
    else
      throw writeMaskInvalidError(label, preview(channel));
  }
  return mask;
}
function fragmentKeyFor(blend, mask) {
  return `${blendKeyFor(blend)};${mask ?? 15}`;
}
function blendKeyFor(blend) {
  if (!blend)
    return "none;none";
  const c = blend.color;
  const a = blend.alpha;
  return `${c.srcFactor},${c.dstFactor},${c.operation};${a.srcFactor},${a.dstFactor},${a.operation}`;
}
function colorStateKeyFor(state) {
  if (!state)
    return "inherit";
  return `${state.blendState ? blendKeyFor(state.blendState) : "inherit"};${state.writeMask ?? "inherit"}`;
}
function preview(value) {
  if (typeof value === "string")
    return `"${value}"`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
function drawWritesDepth(draw) {
  return (drawState(draw, "writesDepth").depthState ?? DEFAULT_DEPTH_STATE).depthWriteEnabled;
}
function drawStencilWritingOps(draw) {
  const state = drawState(draw, "stencilWritingOps");
  const stencil = state.stencilState;
  if (!stencil || stencil.stencilWriteMask === 0)
    return [];
  const cullMode = state.cullMode ?? "none";
  const ops = [];
  const collect = (faceName, face) => {
    if (!face)
      return;
    for (const [name, op] of [["fail", face.failOp], ["depthFail", face.depthFailOp], ["pass", face.passOp]]) {
      if (op !== void 0 && op !== "keep")
        ops.push(`${faceName}.${name}: "${op}"`);
    }
  };
  if (cullMode !== "front")
    collect("front", stencil.stencilFront);
  if (cullMode !== "back")
    collect("back", stencil.stencilBack);
  return ops;
}
function encodeDraw(draw, pass, target2, opts = {}, claimValidation, capture) {
  draw.encode(pass, target2, opts, claimValidation, capture);
}
function drawStateRecord(draw) {
  const state = drawStates.get(draw);
  if (!state)
    throw new TypeError("Invalid Draw instance");
  return state;
}
function drawState(draw, operation = "access") {
  const state = drawStateRecord(draw);
  if ("disposed" in state)
    throw drawDisposedError(state.label, operation);
  return state;
}
function reportDrawValidationError(state, label, group, cause) {
  const delivery = (async () => {
    await submittedWorkDone(state.device);
    assertDeviceUsable(state.device, `${label}.validation`);
    const error = claimedGroupNativeValidationError(label, group, cause);
    if (state.errorSink)
      await state.errorSink(error);
    else
      console.error(error);
  })();
  state.trackSettled?.(delivery);
  return delivery;
}
function createBundleRegistry() {
  const refs = /* @__PURE__ */ new Set();
  const byBundle = /* @__PURE__ */ new WeakMap();
  let pruneCursor;
  function pruneSome(limit = 16) {
    for (let index = 0; index < limit; index += 1) {
      pruneCursor ??= refs.values();
      let next = pruneCursor.next();
      if (next.done) {
        pruneCursor = refs.values();
        next = pruneCursor.next();
        if (next.done)
          return;
      }
      if (!next.value.deref())
        refs.delete(next.value);
    }
  }
  function list() {
    const live = [];
    for (const ref of refs) {
      const bundle = ref.deref();
      if (bundle)
        live.push(bundle);
      else
        refs.delete(ref);
    }
    pruneCursor = void 0;
    return live;
  }
  return {
    add(bundle) {
      pruneSome();
      if (byBundle.has(bundle))
        return;
      const ref = new WeakRef(bundle);
      byBundle.set(bundle, ref);
      refs.add(ref);
    },
    delete(bundle) {
      const ref = byBundle.get(bundle);
      if (ref)
        refs.delete(ref);
      byBundle.delete(bundle);
    },
    list,
    markStale(event) {
      let failure = noCleanupFailure2;
      for (const bundle of list()) {
        try {
          bundle.markStale(event);
        } catch (error) {
          if (failure === noCleanupFailure2)
            failure = error;
        }
      }
      if (failure !== noCleanupFailure2)
        throw failure;
    }
  };
}
function offsetsForGroup(offsets, group, fallback) {
  if (!offsets)
    return fallback;
  if (Array.isArray(offsets))
    return offsets;
  const byGroup = offsets;
  return byGroup[group] ?? fallback;
}
function dynamicEntries(draw, group) {
  const state = drawState(draw);
  return bindGroupLayoutEntriesForGroup(state.reflection.bindings, group, state.visibility).map(dynamicEntry);
}
function dynamicEntry(entry) {
  if (!entry.buffer)
    return entry;
  return { ...entry, buffer: { ...entry.buffer, hasDynamicOffset: true } };
}
function assertSurfaceTargetInFrame(target2, where) {
  if (isSurface(target2) && !isFrameActive())
    throw surfaceNotInFrameError(where);
}

// node_modules/vgpu/dist/fullscreen-stage.js
var FULLSCREEN_VERTEX_SOURCE = `
struct VgpuFullscreenVertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};
@vertex fn vgpu_fullscreen_vs(@builtin(vertex_index) vi: u32) -> VgpuFullscreenVertexOut {
  var pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var uv = array<vec2f, 3>(vec2f(0.0, 1.0), vec2f(2.0, 1.0), vec2f(0.0, -1.0));
  var out: VgpuFullscreenVertexOut;
  out.position = vec4f(pos[vi], 0.0, 1.0);
  out.uv = uv[vi];
  return out;
}
`;
var FULLSCREEN_VERTEX_ENTRY = deepFreeze2({
  name: "vgpu_fullscreen_vs",
  mangledName: "vgpu_fullscreen_vs",
  stage: "vertex",
  bindings: [],
  samplingPairs: [],
  inputs: []
});
function deepFreeze2(value) {
  if (typeof value !== "object" || value === null || Object.isFrozen(value))
    return value;
  for (const nested of Object.values(value))
    deepFreeze2(nested);
  return Object.freeze(value);
}

// node_modules/vgpu/dist/effect.js
function effect(gpu, source, opts = {}) {
  if ("geometry" in opts)
    throw unsupportedError("effect", "effect() never accepts vertex buffers; use draw(gpu, { shader, geometry: geometry(gpu, descriptor) }).");
  const kernel = liveKernel(gpu, "effect");
  const render = renderService(kernel);
  return new InternalEffect(kernel.device, snapshotShaderSource(source), opts, render.binds, void 0, render.pipelines, render.shaderModules, render.pipelineLayouts, (error) => kernel.reportError(error), (promise) => {
    void kernel.trackDelivery(promise);
  });
}
var effectImpls = /* @__PURE__ */ new WeakMap();
var InternalEffect = class {
  get gpu() {
    return effectImpl(this).gpu;
  }
  dispose() {
    effectImpl(this).dispose();
  }
  constructor(device, shader, opts = {}, cache, defaultTarget, pipelineStore, shaderModules, pipelineLayouts, errorSink, trackSettled) {
    const entry = opts.entry;
    if (entry && typeof entry === "object" && "vertex" in entry) {
      throw entryInvalidError(opts.label ?? "effect", "effect does not support vertex entry overrides.", "effect");
    }
    const builtinVertex = shader.reflection.entryPoints.some((item) => item.stage === "vertex") ? void 0 : { source: FULLSCREEN_VERTEX_SOURCE, entry: FULLSCREEN_VERTEX_ENTRY };
    const impl = new InternalDraw(device, shader, { entry, set: opts.set, label: opts.label ?? "effect", blend: opts.blend, writeMask: opts.writeMask }, cache, defaultTarget, pipelineStore, shaderModules, pipelineLayouts, errorSink, trackSettled, builtinVertex);
    effectImpls.set(this, impl);
  }
  set(values) {
    effectImpl(this).set(values);
    return this;
  }
  draw(target2 = {}) {
    effectImpl(this).draw(target2);
  }
  compile(target2) {
    return effectImpl(this).compile(target2).then(() => this);
  }
  compileSync(target2) {
    effectImpl(this).compileSync(target2);
    return this;
  }
  /** @internal FramePass delegates here; not part of the frozen public Effect surface. */
  encode(pass, target2, opts = {}, claimValidation) {
    encodeDraw(effectImpl(this), pass, target2, opts, claimValidation);
  }
  /**
   * Frame drawable protocol: an effect is encoded as its underlying draw, so it reuses that draw's
   * protocol object — same encode path, same depth/stencil metadata for read-only passes.
   */
  get [FRAME_DRAWABLE]() {
    return effectImpl(this)[FRAME_DRAWABLE];
  }
};
function effectImpl(effect2) {
  const impl = effectImpls.get(effect2);
  if (!impl)
    throw new TypeError("Invalid Effect instance");
  return impl;
}

// node_modules/vgpu/dist/frame-uniforms.js
var MAX_RETAINED_UNIFORM_PAGES = 256;
var MAX_RETAINED_UNIFORM_BYTES = 16 * 1024 * 1024;
var pools = /* @__PURE__ */ new WeakMap();
var disposed = /* @__PURE__ */ new WeakSet();
var nextPage = 1;
var FrameUniforms = class {
  device;
  #pages = [];
  #latest = /* @__PURE__ */ new Map();
  #released = false;
  constructor(device) {
    this.device = device;
  }
  capture(value, cache) {
    let captured = this.#latest.get(value.owner);
    if (captured?.revision !== value.revision) {
      captured = this.#write(value);
      this.#latest.set(value.owner, captured);
    }
    captured.page.caches.add(cache);
    return captured;
  }
  flush() {
    for (const page of this.#pages)
      this.device.gpu.queue.writeBuffer(page.buffer, 0, page.bytes.buffer, 0, Math.ceil(page.used / 4) * 4);
  }
  release() {
    if (this.#released)
      return;
    this.#released = true;
    const pool = disposed.has(this.device) ? void 0 : pools.get(this.device);
    for (const page of this.#pages) {
      if (pool && pool.pages.length < MAX_RETAINED_UNIFORM_PAGES && pool.bytes + page.bytes.byteLength <= MAX_RETAINED_UNIFORM_BYTES) {
        for (const cache of page.caches)
          cache.evictIdentity(pageIdentity(page), page.taken);
        pool.pages.push(page);
        pool.bytes += page.bytes.byteLength;
      } else
        destroyPage(page);
    }
    this.#pages.length = 0;
    this.#latest.clear();
  }
  #write(value) {
    const alignment = this.device.limits.minUniformBufferOffsetAlignment || 256;
    const size = value.bytes.byteLength;
    let page = this.#pages.at(-1);
    let offset = Math.ceil((page?.used ?? 0) / alignment) * alignment;
    if (!page || offset + size > page.bytes.byteLength) {
      page = this.#take(size);
      this.#pages.push(page);
      offset = 0;
    }
    page.bytes.set(value.bytes, offset);
    page.used = offset + size;
    let range = page.ranges.get(offset);
    if (range?.identity.size !== size) {
      range = { resource: { buffer: page.buffer, offset, size }, identity: { kind: CAPTURE_PAGE_KIND, id: page.id, offset, size } };
      page.ranges.set(offset, range);
    }
    return { revision: value.revision, page, resource: range.resource, identity: range.identity };
  }
  #take(minimum) {
    let pool = pools.get(this.device);
    if (!pool && !disposed.has(this.device))
      pools.set(this.device, pool = { pages: [], bytes: 0 });
    const index = pool?.pages.findIndex((candidate) => candidate.bytes.byteLength >= minimum) ?? -1;
    const page = index >= 0 ? pool.pages.splice(index, 1)[0] : this.#createPage(minimum);
    if (index >= 0)
      pool.bytes -= page.bytes.byteLength;
    page.used = 0;
    page.taken = bindGroupClock();
    return page;
  }
  #createPage(minimum) {
    const size = Math.min(this.device.limits.maxBufferSize, Math.max(65536, Math.ceil(minimum / 4) * 4));
    const buffer = this.device.gpu.createBuffer({ label: "vgpu.frame.uniforms", size, usage: 64 | 8 });
    return { id: nextPage++, buffer, bytes: new Uint8Array(size), used: 0, taken: 0, caches: /* @__PURE__ */ new Set(), ranges: /* @__PURE__ */ new Map() };
  }
};
function pageIdentity(page) {
  return { kind: CAPTURE_PAGE_KIND, id: page.id };
}
function destroyPage(page) {
  for (const cache of page.caches)
    cache.evictIdentity(pageIdentity(page));
  page.caches.clear();
  page.buffer.destroy();
}
function disposeFrameUniforms(device) {
  disposed.add(device);
  for (const page of pools.get(device)?.pages ?? [])
    destroyPage(page);
  pools.delete(device);
}

// node_modules/vgpu/dist/frame.js
function frame(gpu, cb) {
  return frameRunner(liveKernel(gpu, "frame")).frame(cb);
}
var frameIsOpen;
var frameRunnerToken = serviceToken("frame-runner");
function frameRunner(kernel) {
  return kernel.service(frameRunnerToken, (self) => {
    const state = frameState(self);
    self.own("service", () => disposeFrameUniforms(self.device));
    return new FrameRunner(() => {
      let release = () => {
      };
      const frame2 = new Frame(self.device, void 0, (error) => self.reportError(error), (promise) => {
        void self.trackDelivery(promise);
      }, () => release());
      release = self.own("scheduler", () => frame2.cancel());
      return frame2;
    }, () => state.tick(), (handle) => {
      const releaseScheduler = self.own("scheduler", () => handle.stop());
      const releaseLoss = self.stopOnLoss(() => handle.stop());
      return () => {
        releaseScheduler();
        releaseLoss();
      };
    }, (where) => assertDeviceUsable(self.device, where));
  });
}
var Frame = class {
  device;
  defaultTarget;
  errorSink;
  trackSettled;
  releaseLifecycle;
  /**
   * Resolves after submitted GPU work completes and raw claimed-bind-group
   * validation has been delivered to `gpu.onError`.
   *
   * This is a completion/timing signal only; it never rejects and is not an error
   * channel.
   */
  done = Promise.resolve();
  #encoder;
  #validations = [];
  #computeValidations = [];
  #uniforms;
  #capture = { capture: (value, cache) => (this.#uniforms ??= new FrameUniforms(this.device)).capture(value, cache) };
  /**
   * Everything a pass of this frame attached, as opaque {@link FrameOwner}s: timers and
   * visibilities today, scene view generations later. The frame never learns what they are — it
   * only guarantees each one sees exactly one `frameSubmitted` or `frameAbandoned`.
   */
  #owners = /* @__PURE__ */ new Set();
  /**
   * Owners whose per-frame bookkeeping a failed pass invalidated: their frame is neither finalized
   * nor read back, so a throwing pass callback cannot leave a phantom result. Kept alongside the
   * live set so a later pass re-attaching the same instance in this frame stays dropped too — the
   * failed pass's span/slots are still in that instance's frame bookkeeping.
   */
  #discardedOwners = /* @__PURE__ */ new Set();
  #submitted = false;
  #canceled = false;
  #passActive = false;
  static {
    frameIsOpen = (frame2) => !(#submitted in frame2) || !frame2.#submitted && !frame2.#canceled;
  }
  constructor(device, defaultTarget, errorSink, trackSettled, releaseLifecycle) {
    this.device = device;
    this.defaultTarget = defaultTarget;
    this.errorSink = errorSink;
    this.trackSettled = trackSettled;
    this.releaseLifecycle = releaseLifecycle;
    assertDeviceUsable(device, "Frame.constructor");
    this.#encoder = device.gpu.createCommandEncoder({ label: "vgpu.frame" });
  }
  computePass(options, body) {
    this.#assertPassAvailable("Frame.computePass");
    const callback = typeof options === "function" ? options : body;
    if (typeof callback !== "function")
      throw new VGPUError2({ code: "VGPU-COMPUTE-PASS-INVALID", message: "computePass requires a synchronous callback.", where: "Frame.computePass" });
    const label = typeof options === "function" ? "vgpu.computePass" : options.label ?? "vgpu.computePass";
    const encoder = validateOperation(this.device, this.#computeValidations, `${label}.begin`, () => this.#encoder.beginComputePass({ label }));
    this.#passActive = true;
    let open = true;
    const pass = {
      dispatch: (pipeline, x, y, z) => {
        if (!open)
          throw new VGPUError2({ code: "VGPU-COMPUTE-PASS-CLOSED", message: "The compute pass callback has ended.", where: `${label}.dispatch` });
        assertDeviceUsable(this.device, `${label}.dispatch`);
        const compute = frameComputeOf(pipeline);
        if (!compute || compute.device.gpu !== this.device.gpu)
          throw new VGPUError2({ code: "VGPU-COMPUTE-DEVICE-MISMATCH", message: "Expected a compute pipeline created for this frame's GPU device.", where: `${label}.dispatch` });
        compute.encode(encoder, x, y, z, this.#computeValidations, this.#capture);
      }
    };
    let failed = false;
    try {
      const returned = callback(pass);
      if (returned && typeof returned.then === "function") {
        void Promise.resolve(returned).catch(() => void 0);
        throw new VGPUError2({ code: "VGPU-COMPUTE-PASS-ASYNC", message: "computePass callbacks must be synchronous; await preparation before opening the frame.", where: "Frame.computePass" });
      }
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      open = false;
      this.#passActive = false;
      try {
        validateOperation(this.device, this.#computeValidations, `${label}.end`, () => encoder.end());
      } catch (error) {
        if (!failed)
          throw error;
      }
    }
  }
  #assertPassAvailable(where) {
    if (this.#canceled)
      throw frameCanceledError(where);
    if (this.#submitted)
      throw frameAlreadySubmittedError(where);
    assertDeviceUsable(this.device, where);
    if (this.#passActive)
      throw framePassActiveError(where);
  }
  pass(target2, body) {
    if (this.#canceled)
      throw frameCanceledError("Frame.pass");
    assertDeviceUsable(this.device, "Frame.pass");
    if (this.#passActive)
      throw framePassActiveError("Frame.pass");
    if (this.#submitted && !isSurface(isTarget(target2) ? target2 : target2.target))
      throw frameAlreadySubmittedError("Frame.pass");
    const targetOnly = isTarget(target2);
    const cb = typeof body === "function" ? body : (p) => p.draw(body);
    const resolvedTarget = targetOnly ? target2 : target2.target ?? this.defaultTarget;
    if (!resolvedTarget)
      throw targetRequiredError("Frame.pass");
    if (isSurface(resolvedTarget) && this.#submitted)
      throw surfaceNotInFrameError("Frame.pass");
    const clear = targetOnly ? void 0 : target2.clear;
    const preserve = clear === false;
    if (preserve && resolvedTarget.sampleCount === 4)
      throw passPreserveMsaaError();
    const clearDepth = targetOnly ? void 0 : target2.clearDepth;
    if (clearDepth !== void 0) {
      if (typeof clearDepth !== "number" || !(clearDepth >= 0 && clearDepth <= 1))
        throw passClearDepthInvalidError(clearDepth);
      if (preserve)
        throw passPreserveClearDepthError();
      if (!resolvedTarget.depth) {
        throw passClearDepthInvalidError(clearDepth, "but the target has no depth attachment, so clearDepth would have no effect.", "Create the target with depth: true (or a depth format), or drop clearDepth.");
      }
    }
    const clearStencil = targetOnly ? void 0 : target2.clearStencil;
    if (clearStencil !== void 0) {
      if (typeof clearStencil !== "number" || !Number.isInteger(clearStencil) || clearStencil < 0 || clearStencil > 4294967295) {
        throw passClearStencilInvalidError(`received ${String(clearStencil)}; expected an integer in [0, 0xFFFFFFFF] (WebGPU GPUStencilValue).`);
      }
      if (preserve)
        throw passPreserveClearStencilError();
      const depthFormat = resolvedTarget.depth?.format;
      if (!hasStencilAspect(depthFormat))
        throw passClearStencilInvalidError(`received ${String(clearStencil)}, but the target's depth format ${depthFormat ? `"${depthFormat}"` : "(none)"} has no stencil aspect, so clearStencil would have no effect.`);
    }
    const depthReadOnly = targetOnly ? void 0 : target2.depthReadOnly;
    if (depthReadOnly !== void 0 && typeof depthReadOnly !== "boolean") {
      throw passDepthReadOnlyError(`received ${previewValue(depthReadOnly)}; expected a boolean.`, "Pass depthReadOnly: true to open the pass with a read-only depth attachment, or omit it.");
    }
    if (depthReadOnly) {
      if (!resolvedTarget.depth)
        throw passDepthReadOnlyError("is set, but the target has no depth attachment, so there is nothing to make read-only.", "Create the target with depth: true (or a depth format), or drop depthReadOnly.");
      if (resolvedTarget.sampleCount === 4)
        throw passDepthReadOnlyMsaaError();
      if (clearDepth !== void 0)
        throw passDepthReadOnlyError("cannot be combined with clearDepth; a read-only depth aspect omits its load/store ops and is never cleared.", "Remove clearDepth, or drop depthReadOnly.");
      if (clearStencil !== void 0)
        throw passDepthReadOnlyError("cannot be combined with clearStencil; a read-only stencil aspect omits its load/store ops and is never cleared.", "Remove clearStencil, or drop depthReadOnly.");
    }
    const viewport = targetOnly ? void 0 : validatedViewport(target2.viewport, this.device.gpu.limits, resolvedTarget.size);
    const scissor = targetOnly ? void 0 : validatedScissor(target2.scissor, resolvedTarget.size);
    const attached = [];
    let encoder;
    try {
      const timer = targetOnly || target2.timer === void 0 ? void 0 : this.#attach(target2.timer, resolvedTarget, attached, timerAttachmentInvalidError);
      const visibility = targetOnly || target2.visibility === void 0 ? void 0 : this.#attach(target2.visibility, resolvedTarget, attached, visibilityAttachmentInvalidError);
      const occlusion = visibility?.occlusion;
      let descriptor = resolvedTarget.renderPassDescriptor({ clear: clear === void 0 || clear === true || clear === false ? resolvedTarget.clearColor ?? BUILT_IN_CLEAR_COLOR : clear, preserve, clearDepth, clearStencil, depthReadOnly });
      if (timer?.timestampWrites)
        descriptor = { ...descriptor, timestampWrites: timer.timestampWrites };
      if (occlusion)
        descriptor = { ...descriptor, occlusionQuerySet: occlusion.querySet };
      encoder = this.#encoder.beginRenderPass(descriptor);
      if (viewport)
        encoder.setViewport(viewport.x, viewport.y, viewport.width, viewport.height, viewport.minDepth, viewport.maxDepth);
      if (scissor)
        encoder.setScissorRect(scissor[0], scissor[1], scissor[2], scissor[3]);
      this.#passActive = true;
      try {
        cb(new FramePass(encoder, resolvedTarget, this.#validations, depthReadOnly === true, occlusion, this, (where) => {
          assertDeviceUsable(this.device, where);
          if (this.#canceled)
            throw frameCanceledError(where);
          if (!this.#passActive)
            throw framePassActiveError(where);
        }, this.#capture));
      } finally {
        this.#passActive = false;
      }
    } catch (error) {
      this.#discardOwners(attached);
      discardClaimedGroupValidationResults(this.#validations);
      this.#validations.length = 0;
      discardClaimedGroupValidationScopes(this.device);
      try {
        encoder?.end();
      } catch {
      }
      throw error;
    }
    endRenderPassWithClaimValidation(this.device, encoder, this.#validations);
  }
  submit() {
    if (this.#submitted || this.#canceled)
      return;
    assertDeviceUsable(this.device, "Frame.submit");
    if (this.#passActive)
      throw framePassActiveError("Frame.submit");
    this.#submitted = true;
    this.releaseLifecycle?.();
    try {
      for (const owner of this.#liveOwners())
        owner.finalizeFrame(this, this.#encoder);
    } catch (error) {
      this.#uniforms?.release();
      this.#abandonOwners(this.#frameOwners());
      throw error;
    }
    try {
      this.#uniforms?.flush();
    } catch (error) {
      this.#uniforms?.release();
      this.#abandonOwners(this.#frameOwners());
      throw error;
    }
    let commandBuffer;
    const finishContext = this.#validations[0]?.context;
    if (finishContext)
      pushClaimedGroupValidationScope(this.device, finishContext);
    try {
      commandBuffer = this.#computeValidations.length ? validateOperation(this.device, this.#computeValidations, "Frame.finish", () => this.#encoder.finish()) : this.#encoder.finish();
    } catch (error) {
      this.#abandonOwners(this.#frameOwners());
      const result = finishContext ? popLastClaimedGroupValidationScope(this.device) : void 0;
      discardClaimedGroupValidationResults(this.#validations);
      if (result)
        discardClaimedGroupValidationResults([result]);
      const context = result?.context ?? finishContext;
      if (!context) {
        this.#uniforms?.release();
        throw error;
      }
      this.done = this.#trackDone(this.#deliverValidationError(context.label, context.group, error));
      return;
    }
    if (finishContext) {
      const result = popLastClaimedGroupValidationScope(this.device);
      if (result)
        this.#validations[0] = this.#validations[0] ? preferClaimedGroupValidationResult(result, this.#validations[0]) : result;
    }
    const submitContext = this.#validations[0]?.context;
    if (submitContext)
      pushClaimedGroupValidationScope(this.device, submitContext);
    try {
      if (this.#computeValidations.length)
        validateOperation(this.device, this.#computeValidations, "Frame.submit", () => this.device.gpu.queue.submit([commandBuffer]));
      else
        this.device.gpu.queue.submit([commandBuffer]);
    } catch (error) {
      this.#abandonOwners(this.#frameOwners());
      const result = submitContext ? popLastClaimedGroupValidationScope(this.device) : void 0;
      discardClaimedGroupValidationResults(this.#validations);
      if (result)
        discardClaimedGroupValidationResults([result]);
      const context = result?.context ?? submitContext;
      if (!context) {
        this.#uniforms?.release();
        throw error;
      }
      this.done = this.#trackDone(this.#deliverValidationError(context.label, context.group, error));
      return;
    }
    if (submitContext) {
      const result = popLastClaimedGroupValidationScope(this.device);
      if (result)
        this.#validations[0] = this.#validations[0] ? preferClaimedGroupValidationResult(result, this.#validations[0]) : result;
    }
    for (const owner of this.#liveOwners())
      owner.frameSubmitted(this);
    this.#abandonOwners(this.#discardedOwners);
    this.done = this.#trackDone(Promise.all([claimedGroupValidationDone(this.device, this.#validations, { errorSink: this.errorSink }), deliverOperations(this.#computeValidations, this.errorSink ?? ((error) => console.error(error)))]).then(() => void 0));
  }
  /**
   * Discards the frame without submitting it: the command encoder is dropped (nothing this frame
   * encoded ever runs) and every telemetry instance it attached releases the retain it took on its
   * query ring, so a `timer(gpu)` / `visibility(gpu)` can be disposed for good without waiting for
   * `gpu.dispose()`. This is the explicit way out of the leak a manual `frame(gpu)` would otherwise
   * hold: a frame is never assumed abandoned, because an old frame can still be submitted.
   *
   * Idempotent, like `submit()`: cancelling twice is a no-op, and `submit()` after `cancel()` does
   * nothing. Cancelling a frame that was already submitted throws `VGPU-FRAME-SUBMITTED` — its work
   * is on the queue and cannot be taken back, so silently accepting the call would hide a real
   * lifecycle bug.
   */
  cancel() {
    if (this.#canceled)
      return;
    if (this.#submitted)
      throw frameAlreadySubmittedError("Frame.cancel");
    if (this.#passActive)
      throw framePassActiveError("Frame.cancel");
    this.#canceled = true;
    this.#uniforms?.release();
    this.#computeValidations.length = 0;
    this.releaseLifecycle?.();
    this.#abandonOwners(this.#frameOwners());
    this.#owners.clear();
    this.#discardedOwners.clear();
    discardClaimedGroupValidationResults(this.#validations);
    this.#validations.length = 0;
  }
  /**
   * Ends the frame for telemetry instances that will never see a real frameSubmitted: a pass whose
   * callback threw, a frame whose finish/submit failed, or a canceled frame. Each one took a retain
   * on its query ring when it was attached to a pass descriptor (so a mid-frame dispose() cannot
   * destroy a set the frame still points at); without the matching release, a dispose() after the
   * failure leaves the ring alive forever. frameAbandoned() drops the instance's pending encoded
   * state as it releases: a resolve that never reached the queue must not be decoded — its staging
   * buffer holds stale bytes, which would surface as a phantom duration or a phantom "hidden".
   */
  #abandonOwners(owners) {
    for (const owner of [...owners])
      owner.frameAbandoned(this);
  }
  /** Every owner this frame attached, discarded ones included. */
  #frameOwners() {
    return [...this.#owners, ...this.#discardedOwners];
  }
  /** Moves owners out of this frame's live set: they are neither finalized nor read back. */
  #discardOwners(owners) {
    for (const owner of [...owners]) {
      this.#owners.delete(owner);
      this.#discardedOwners.add(owner);
    }
  }
  #liveOwners() {
    return [...this.#owners].filter((owner) => !this.#discardedOwners.has(owner));
  }
  /**
   * Attaches one `FramePassOptions` telemetry value to this pass through the nominal attachment
   * protocol, so the frame never learns whether it is a timer span, a visibility or a future
   * scene-view generation: it only records the owner it must settle exactly once.
   */
  #attach(value, target2, attached, invalid) {
    const attachment = framePassAttachmentOf(value);
    if (!attachment)
      throw invalid(value);
    let result;
    try {
      result = attachment[FRAME_PASS_ATTACHMENT]({ frame: this, device: this.device, target: target2 });
    } catch (error) {
      this.#discardOwners(this.#owners);
      throw error;
    }
    this.#owners.add(result.owner);
    attached.push(result.owner);
    return result;
  }
  async #deliverValidationError(label, group, cause) {
    await submittedWorkDone(this.device);
    assertDeviceUsable(this.device, "Frame.validation");
    const error = claimedGroupNativeValidationError(label, group, cause);
    if (this.errorSink)
      await this.errorSink(error);
    else
      console.error(error);
  }
  #trackDone(promise) {
    const done = promise.catch((cause) => {
      const error = cause instanceof VGPUError2 ? cause : new VGPUError2({ code: "VGPU-FRAME-COMPLETION", message: "GPU frame completion failed.", where: "Frame.done", cause });
      return this.errorSink ? this.errorSink(error) : console.error(error);
    }).finally(() => this.#uniforms?.release());
    this.trackSettled?.(done);
    return done;
  }
};
var FramePass = class {
  encoder;
  target;
  validations;
  depthReadOnly;
  occlusionSource;
  frame;
  assertFrameOpen;
  capture;
  #occlusionActive = false;
  constructor(encoder, target2, validations2, depthReadOnly = false, occlusionSource, frame2, assertFrameOpen, capture) {
    this.encoder = encoder;
    this.target = target2;
    this.validations = validations2;
    this.depthReadOnly = depthReadOnly;
    this.occlusionSource = occlusionSource;
    this.frame = frame2;
    this.assertFrameOpen = assertFrameOpen;
    this.capture = capture;
  }
  draw(drawable, opts = {}) {
    this.assertFrameOpen?.("FramePass.draw");
    const encodable = frameDrawable(drawable);
    if (this.depthReadOnly)
      assertDrawableAllowedInReadOnlyPass(encodable, this.target);
    encodable.encode(this.encoder, this.target, opts, (result) => this.validations.push(result), this.capture);
  }
  /**
   * Wraps one or more draws in begin/endOcclusionQuery. The body ALWAYS executes; condition your
   * real draws on `q.hidden` outside.
   */
  occlusion(query, body) {
    this.assertFrameOpen?.("FramePass.occlusion");
    if (!this.occlusionSource)
      throw queryNoVisibilityError();
    if (this.#occlusionActive)
      throw queryNestedError();
    const index = this.occlusionSource.beginQuery(query, this.frame);
    this.encoder.beginOcclusionQuery(index);
    this.#occlusionActive = true;
    try {
      if (typeof body === "function")
        body();
      else
        this.draw(body);
    } finally {
      this.#occlusionActive = false;
      this.encoder.endOcclusionQuery();
    }
  }
  bundles(...bundles) {
    this.assertFrameOpen?.("FramePass.bundles");
    if (this.depthReadOnly)
      throw passDepthReadOnlyError("pass cannot replay bundles: bundle records bundles with writable depth/stencil, and WebGPU only executes read-only-recorded bundles in a read-only pass.", "Encode the draws directly with pass.draw(...) inside the depthReadOnly pass.", "FramePass.bundles");
    const recorded = bundles.map((entry) => frameBundleOf(entry) ?? invalidBundle());
    for (const entry of recorded)
      entry.assertReplayable(this.target);
    this.encoder.executeBundles(recorded.map((entry) => entry.gpu));
  }
};
function assertDrawableAllowedInReadOnlyPass(drawable, target2) {
  if (drawable.writesDepth()) {
    throw passDepthReadOnlyError(`pass cannot encode draw '${drawable.label}': its depth state writes depth (the default is write: true). Give the draw depth: { write: false } (or depth: false to disable depth testing).`, "Use depth: { write: false } on the draw, or open the pass without depthReadOnly.", "FramePass.draw");
  }
  if (hasStencilAspect(target2.depth?.format)) {
    const ops = drawable.stencilWritingOps();
    if (ops.length) {
      throw passDepthReadOnlyError(`pass cannot encode draw '${drawable.label}': its stencil ops can write (${ops.join(", ")}), and the pass's stencil aspect is read-only too.`, `Use "keep" for those ops or stencil writeMask: 0, or open the pass without depthReadOnly.`, "FramePass.draw");
    }
  }
}
function frameDrawable(drawable) {
  const encodable = frameDrawableOf(drawable);
  if (!encodable)
    throw new TypeError("Invalid Effect instance: pass.draw() expects a Draw or an Effect created by this library.");
  return encodable;
}
function invalidBundle() {
  throw new VGPUError2({ code: "VGPU-R3-BUNDLE-INVALID", message: "p.bundles() expected bundles created by bundle(gpu, { target }, cb).", where: "FramePass.bundles" });
}
function timerAttachmentInvalidError(value) {
  return timerInvalidError(`FramePassOptions.timer received ${previewValue(value)}; expected a TimerSpan from timer.span(name).`, `Create const passTimer = timer(gpu) once, then pass passTimer.span("name") per pass.`, "Frame.pass");
}
function visibilityAttachmentInvalidError(value) {
  return visibilityInvalidError(`FramePassOptions.visibility received ${previewValue(value)}; expected a Visibility from visibility(gpu).`, "Create const vis = visibility(gpu) once, then pass { target, visibility: vis } per pass.", "Frame.pass");
}
function validatedViewport(viewport, limits, targetSize) {
  if (viewport === void 0)
    return void 0;
  if (typeof viewport !== "object" || viewport === null || Array.isArray(viewport))
    throw passViewportInvalidError(`received ${previewValue(viewport)}; expected { x?, y?, width, height, minDepth?, maxDepth? }.`);
  const { x = 0, y = 0, width, height, minDepth = 0, maxDepth = 1 } = viewport;
  for (const [name, value] of [["x", x], ["y", y], ["width", width], ["height", height], ["minDepth", minDepth], ["maxDepth", maxDepth]]) {
    if (typeof value !== "number" || !Number.isFinite(value))
      throw passViewportInvalidError(`${name} received ${previewValue(value)}; expected a finite number.`);
  }
  const max = limits.maxTextureDimension2D;
  const maxViewportRange = max * 2;
  const sizeNote = `target is ${targetSize[0]}x${targetSize[1]}px, device maxTextureDimension2D is ${max}`;
  if (!(width >= 0 && width <= max))
    throw passViewportInvalidError(`width ${width} is outside [0, ${max}] (${sizeNote}).`);
  if (!(height >= 0 && height <= max))
    throw passViewportInvalidError(`height ${height} is outside [0, ${max}] (${sizeNote}).`);
  if (!(x >= -maxViewportRange && x + width <= maxViewportRange - 1))
    throw passViewportInvalidError(`x ${x} with width ${width} is outside [${-maxViewportRange}, ${maxViewportRange - 1}] (${sizeNote}).`);
  if (!(y >= -maxViewportRange && y + height <= maxViewportRange - 1))
    throw passViewportInvalidError(`y ${y} with height ${height} is outside [${-maxViewportRange}, ${maxViewportRange - 1}] (${sizeNote}).`);
  if (!(minDepth >= 0 && minDepth <= 1))
    throw passViewportInvalidError(`minDepth ${minDepth} is outside [0, 1].`);
  if (!(maxDepth >= 0 && maxDepth <= 1))
    throw passViewportInvalidError(`maxDepth ${maxDepth} is outside [0, 1].`);
  if (!(minDepth <= maxDepth))
    throw passViewportInvalidError(`minDepth ${minDepth} exceeds maxDepth ${maxDepth}.`);
  return { x, y, width, height, minDepth, maxDepth };
}
function validatedScissor(scissor, targetSize) {
  if (scissor === void 0)
    return void 0;
  if (!Array.isArray(scissor) || scissor.length !== 4)
    throw passScissorInvalidError(`received ${previewValue(scissor)}; expected [x, y, width, height].`);
  const [x, y, width, height] = scissor;
  for (const [name, value] of [["x", x], ["y", y], ["width", width], ["height", height]]) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
      throw passScissorInvalidError(`${name} received ${previewValue(value)}; expected a non-negative integer.`);
  }
  const [targetWidth, targetHeight] = targetSize;
  if (x + width > targetWidth || y + height > targetHeight) {
    throw passScissorInvalidError(`[${x}, ${y}, ${width}, ${height}] exceeds the target's current size ${targetWidth}x${targetHeight}px (x + width <= ${targetWidth}, y + height <= ${targetHeight}).`);
  }
  return [x, y, width, height];
}
function previewValue(value) {
  if (typeof value === "string")
    return `'${value}'`;
  if (Array.isArray(value))
    return `[${value.map((entry) => previewValue(entry)).join(", ")}]`;
  if (typeof value === "object" && value !== null)
    return "an object";
  return String(value);
}
function isThenable(value) {
  return value !== null && (typeof value === "object" || typeof value === "function") && typeof value.then === "function";
}
var FrameRunner = class {
  createFrame;
  advance;
  trackLoop;
  assertActive;
  #running = false;
  /**
   * @param trackLoop Lifecycle hook for the owning gpu: called with each started loop handle and
   * returns the untrack function the handle runs when it stops on its own, so `gpu.dispose()` can
   * stop the loops still running without holding on to the ones already stopped.
   */
  constructor(createFrame, advance, trackLoop, assertActive) {
    this.createFrame = createFrame;
    this.advance = advance;
    this.trackLoop = trackLoop;
    this.assertActive = assertActive;
  }
  frame(cb) {
    return this.#runFrame(cb, "frame");
  }
  #runFrame(cb, where) {
    if (this.#running || isSurfaceResizeCallbackActive())
      throw frameReentrantError();
    this.assertActive?.(where);
    this.#running = true;
    enterFrame();
    try {
      this.advance();
      const frame2 = this.createFrame();
      if (cb) {
        try {
          const returned = cb(frame2);
          if (isThenable(returned)) {
            void Promise.resolve(returned).catch(() => void 0);
            throw asyncFrameCallbackError(where);
          }
        } catch (error) {
          if (frameIsOpen(frame2)) {
            try {
              frame2.cancel();
            } catch {
            }
          }
          throw error;
        }
        frame2.submit();
      }
      return frame2;
    } finally {
      leaveFrame();
      this.#running = false;
    }
  }
  loop(cb, opts = {}) {
    let stopped = false;
    const request = globalThis.requestAnimationFrame ?? ((fn) => setTimeout(() => fn(performance.now()), 16));
    const cancel = globalThis.cancelAnimationFrame ?? ((id2) => clearTimeout(id2));
    const minIntervalMs = opts.fps && opts.fps > 0 ? 1e3 / opts.fps : 0;
    let lastFrameMs;
    let id = 0;
    let untrack;
    const stop = () => {
      stopped = true;
      cancel(id);
      untrack?.();
      untrack = void 0;
    };
    const tick = (timestamp) => {
      if (stopped)
        return;
      if (shouldRunFrame(timestamp, lastFrameMs, minIntervalMs)) {
        lastFrameMs = timestamp;
        try {
          this.#runFrame(cb, "frameLoop");
        } catch (error) {
          stop();
          throw error;
        }
      }
      if (!stopped)
        id = request(tick);
    };
    id = request(tick);
    const handle = { stop };
    untrack = this.trackLoop?.(handle);
    return handle;
  }
};
var FRAME_INTERVAL_SLACK_MS = 1;
function shouldRunFrame(timestamp, lastFrameMs, minIntervalMs) {
  if (lastFrameMs === void 0)
    return true;
  if (minIntervalMs <= 0)
    return true;
  return timestamp - lastFrameMs >= minIntervalMs - FRAME_INTERVAL_SLACK_MS;
}

// node_modules/vgpu/dist/target-offscreen.js
function destroyTextures2(textures) {
  const errors = [];
  for (const texture of textures) {
    try {
      texture.destroy();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw errors[0];
}
function target(gpu, opts) {
  return new OffscreenTarget(liveKernel(gpu, "target").device, opts);
}
var OffscreenTarget = class {
  device;
  resourceIdentity = createResourceIdentity("render-target");
  #destroySignal = new DestroySignal();
  #texturesRecreatedCallbacks = /* @__PURE__ */ new Set();
  #currentSize;
  #attachments;
  #clearColor;
  #destroyed = false;
  #replacing = false;
  options;
  constructor(device, options) {
    this.device = device;
    validateTargetOptions(options, device);
    this.options = Object.freeze({
      ...options,
      size: Object.freeze([...options.size]),
      ...options.colors ? { colors: Object.freeze(options.colors.map((color) => Object.freeze({ ...color }))) } : {}
    });
    this.#clearColor = options.clearColor === void 0 ? BUILT_IN_CLEAR_COLOR : validateClearColor(options.clearColor, "target.clearColor");
    this.#currentSize = this.options.size;
    this.#attachments = this.#allocateTextures(this.#currentSize);
  }
  get gpu() {
    return this.color.gpu;
  }
  get size() {
    return this.#currentSize;
  }
  get texelSize() {
    return [1 / this.#currentSize[0], 1 / this.#currentSize[1]];
  }
  /** Resolved, sampleable color texture. For MSAA targets, render passes resolve into this texture. */
  get color() {
    return this.#attachments.colors[0];
  }
  /** Resolved, sampleable color textures. For MSAA targets, render passes resolve into these textures. */
  get colors() {
    return this.#attachments.colors;
  }
  get depth() {
    return this.#attachments.depth;
  }
  get format() {
    return colorSpecsFor(this.options)[0]?.format ?? "rgba8unorm";
  }
  /** Default clear color of this target; passes that clear without naming a color use it. */
  get clearColor() {
    return copyClearColor(this.#clearColor);
  }
  set clearColor(value) {
    this.#clearColor = validateClearColor(value, "target.clearColor");
  }
  get sampleCount() {
    return sampleCountFor(this.options);
  }
  resize(size) {
    this.#assertAlive("Target.resize");
    if (this.#replacing)
      throw new VGPUError2({ code: "VGPU-TARGET-RESIZE-REENTRANT", message: "Cannot resize a target from its replacement callbacks.", where: "Target.resize" });
    validateTargetOptions({ ...this.options, size }, this.device);
    if (sameSize(this.#currentSize, size))
      return;
    this.#replacing = true;
    try {
      const nextSize = Object.freeze([...size]);
      const next = this.#allocateTextures(nextSize);
      const previous = this.#attachments;
      this.#currentSize = nextSize;
      this.#attachments = next;
      try {
        this.#emitTexturesRecreated();
      } finally {
        destroyTextures2(previous.all);
      }
    } finally {
      this.#replacing = false;
    }
  }
  onDestroy(cb) {
    return this.#destroySignal.onDestroy(this, cb);
  }
  onTexturesRecreated(cb) {
    this.#assertAlive("Target.onTexturesRecreated");
    this.#texturesRecreatedCallbacks.add(cb);
    return () => {
      this.#texturesRecreatedCallbacks.delete(cb);
    };
  }
  destroy() {
    if (this.#destroyed)
      return;
    this.#destroyed = true;
    try {
      this.#destroySignal.emit(this);
    } finally {
      this.#texturesRecreatedCallbacks.clear();
      destroyTextures2(this.#attachments.all);
    }
  }
  renderPassDescriptor(opts = {}) {
    this.#assertAlive("Target.renderPassDescriptor");
    const { clear = [0, 0, 0, 1], preserve, clearDepth, clearStencil, depthReadOnly } = opts;
    return {
      colorAttachments: this.colors.map((resolved, index) => colorAttachment(resolved, this.#attachments.msaaColors?.[index], clear, preserve)),
      depthStencilAttachment: this.depth ? depthAttachment(this.depth, preserve, clearDepth, clearStencil, depthReadOnly) : void 0
    };
  }
  #assertAlive(where) {
    if (this.#destroyed)
      throw new VGPUError2({ code: "VGPU-TARGET-DESTROYED", message: `Target '${this.options.label ?? "target"}' is destroyed.`, where, fix: "Create a new target; destroyed targets cannot be resized or rendered." });
    assertDeviceUsable(this.device, where);
  }
  #emitTexturesRecreated() {
    const errors = [];
    for (const cb of [...this.#texturesRecreatedCallbacks]) {
      try {
        cb();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw errors[0];
  }
  #allocateTextures(size) {
    const allocated = [];
    const create = (opts) => {
      const texture = this.device.createTexture(opts);
      allocated.push(texture);
      return texture;
    };
    try {
      const colors = this.#createResolvedColors(size, create);
      const msaaColors = this.sampleCount === 4 ? this.#createMsaaColors(size, create) : void 0;
      const depth = this.#createDepth(size, create);
      return { colors: Object.freeze(colors), msaaColors: msaaColors && Object.freeze(msaaColors), depth, all: allocated };
    } catch (error) {
      try {
        destroyTextures2(allocated);
      } catch {
      }
      throw error;
    }
  }
  #createResolvedColors(size, create) {
    return colorSpecsFor(this.options).map((spec, index) => create({
      kind: "2d",
      size,
      format: spec.format,
      usage: ["render_attachment", "texture_binding", "copy_src"],
      sampleCount: 1,
      label: this.options.label ? `${this.options.label}.color${index}.resolve` : void 0
    }));
  }
  #createMsaaColors(size, create) {
    return colorSpecsFor(this.options).map((spec, index) => create({
      kind: "2d",
      size,
      format: spec.format,
      usage: ["render_attachment"],
      sampleCount: 4,
      label: this.options.label ? `${this.options.label}.color${index}` : void 0
    }));
  }
  #createDepth(size, create) {
    const format = depthFormatFor(this.options);
    return format ? create({
      kind: "2d",
      size,
      format,
      // texture_binding lets later passes read the depth (fog, occlusion, SSAO) without a copy.
      usage: ["render_attachment", "texture_binding"],
      sampleCount: this.sampleCount,
      label: this.options.label ? `${this.options.label}.depth` : void 0
    }) : void 0;
  }
};

// node_modules/vgpu/dist/storage.js
function storage(gpu, bytes, access = "read-write") {
  const kernel = liveKernel(gpu, "storage");
  const opts = typeof access === "string" ? { access } : access;
  const buffer = createStorageBuffer(kernel.device, bytes, opts.access ?? "read-write", void 0, opts.indirect ?? false);
  return ownResource(kernel, buffer, (owned) => owned.destroy(), (cb) => {
    buffer.onDestroy(cb);
  });
}
var RingStorageBuffer = class _RingStorageBuffer {
  size;
  access;
  buffer;
  constructor(buffer, access) {
    this.buffer = buffer;
    this.access = access;
    this.size = buffer.options.size;
  }
  static create(device, bytes, access, label, indirect = false) {
    const usage = indirect ? ["storage", "copy_dst", "copy_src", "indirect"] : ["storage", "copy_dst", "copy_src"];
    const buffer = device.createBuffer({
      size: bytes,
      usage,
      label
    });
    return new _RingStorageBuffer(buffer, access);
  }
  read() {
    return this.buffer.read(this.size);
  }
  write(data, offset = 0) {
    this.buffer.write(asWriteData(data), offset);
  }
  get gpu() {
    return this.buffer.gpu;
  }
  get resourceIdentity() {
    return this.buffer.resourceIdentity;
  }
  onDestroy(cb) {
    return this.buffer.onDestroy(cb);
  }
  /** Frees the GPU allocation. Idempotent; bind groups holding it are invalidated through the buffer's destroy signal. */
  destroy() {
    this.buffer.destroy();
  }
};
function createStorageBuffer(device, bytes, access, label, indirect = false) {
  return RingStorageBuffer.create(device, bytes, access, label, indirect);
}
function asWriteData(data) {
  if (data instanceof ArrayBuffer)
    return data;
  if (ArrayBuffer.isView(data))
    return data;
  throw new TypeError("StorageBuffer.write() requires ArrayBuffer or ArrayBufferView.");
}

// node_modules/vgpu/dist/uniforms-layout.js
function sharedUniformLayoutSignature(layout) {
  return JSON.stringify(signatureNode(layout));
}
function formatSharedUniformLayout(layout, opts = {}) {
  if (layout.members?.length)
    return formatStructLayout(layout.members, opts.abbreviated === true);
  if (layout.element)
    return formatArrayLayout(layout);
  return formatType(layout.type);
}
function signatureNode(layout) {
  return {
    type: typeSignature(layout.type),
    align: layout.align,
    size: layout.size,
    stride: layout.stride,
    members: layout.members?.map(memberSignature),
    element: layout.element ? signatureNode(layout.element) : void 0
  };
}
function memberSignature(member) {
  return {
    name: member.name,
    offset: member.offset,
    align: member.align,
    size: member.size,
    explicitAlign: member.explicitAlign,
    explicitSize: member.explicitSize,
    type: typeSignature(member.type),
    layout: signatureNode(member.layout)
  };
}
function typeSignature(type) {
  switch (type.kind) {
    case "scalar":
      return { scalar: type.name };
    case "vector":
      return { vector: type.width, element: typeSignature(type.element) };
    case "matrix":
      return { matrix: [type.columns, type.rows], element: typeSignature(type.element) };
    case "array":
      return { array: typeSignature(type.element), count: type.count ?? type.countExpression };
    case "atomic":
      return { atomic: typeSignature(type.element) };
    default:
      return type.kind;
  }
}
function formatStructLayout(members, abbreviated) {
  const shown = abbreviated ? members.slice(0, 1) : members;
  const suffix = abbreviated && members.length > 1 ? ", ..." : "";
  return `{ ${shown.map(formatMember).join(", ")}${suffix} }`;
}
function formatArrayLayout(layout) {
  const count = arrayCount(layout.type);
  const suffix = count === void 0 ? "" : `, ${count}`;
  return `array<${formatSharedUniformLayout(layout.element)}${suffix}>`;
}
function formatMember(member) {
  return `${member.name}: ${formatSharedUniformLayout(member.layout)}`;
}
function formatType(type) {
  switch (type.kind) {
    case "scalar":
      return type.name;
    case "vector":
      return `vec${type.width}${scalarSuffix(type.element)}`;
    case "matrix":
      return `mat${type.columns}x${type.rows}${scalarSuffix(type.element)}`;
    case "array":
      return formatArrayType(type);
    case "identifier":
      return type.name;
    case "atomic":
      return `atomic<${formatType(type.element)}>`;
    default:
      return type.kind;
  }
}
function formatArrayType(type) {
  const count = type.count ?? type.countExpression;
  const suffix = count === void 0 ? "" : `, ${count}`;
  return `array<${formatType(type.element)}${suffix}>`;
}
function scalarSuffix(type) {
  if (type.kind !== "scalar")
    return "";
  if (type.name === "bool")
    return "b";
  return type.name.slice(0, 1);
}
function arrayCount(type) {
  return type.kind === "array" ? type.count ?? type.countExpression : void 0;
}

// node_modules/vgpu/dist/uniforms.js
var SharedUniformsImpl = class {
  device;
  #values;
  #revision = 0;
  #bytes;
  #state;
  #bufferRef;
  #dirty = false;
  #liveUniform = false;
  #captureToken = {};
  #uniformValue;
  constructor(device, initialValues) {
    this.device = device;
    this.#values = cloneRecord(initialValues);
  }
  get buffer() {
    this.#prepareUniform(true);
    return this.#bufferRef;
  }
  get gpu() {
    this.#prepareUniform(true);
    return this.#bufferRef?.gpu;
  }
  get size() {
    return this.#state?.layout.size;
  }
  set(values) {
    const next = cloneRecord(this.#values);
    mergeInto(next, values);
    if (this.#state && this.#bufferRef) {
      assertBufferUsable(this.#bufferRef, "uniforms.set");
      const bytes = writeLayoutValue(this.#state.layout, next);
      const live = this.#liveUniform || this.#state.addressSpace === "storage";
      if (live)
        this.#bufferRef.write(bytes, 0);
      if (!this.#bytes || !bytesEqual(this.#bytes, bytes)) {
        this.#bytes = new Uint8Array(bytes);
        this.#revision += 1;
        this.#dirty = !live;
      } else if (live)
        this.#dirty = false;
    } else
      this.#revision += 1;
    this.#values = next;
  }
  /**
   * Adopts or validates the reflected binding layout, then returns a user-owned resource.
   *
   * Keyed by the nominal protocol symbol so `set-resources.ts` recognizes a shared uniforms block
   * without importing this module: binding a plain buffer must not link the layout machinery.
   */
  [BINDING_RESOURCE](binding, sourceHint) {
    ensureBufferBinding(binding);
    const adopted = this.#ensureLayout(binding, sourceHint);
    const buffer = this.#requiredBuffer();
    assertBufferUsable(buffer, `${sourceHint}.set`);
    return {
      resourceLabel: buffer.options.label ?? buffer.gpu.label,
      resource: { buffer: buffer.gpu, offset: 0, size: adopted.layout.size },
      ...adopted.addressSpace === "uniform" ? {
        uniformValue: () => this.#currentUniformValue(),
        prepareUniform: (retain) => this.#prepareUniform(retain)
      } : {},
      identity: buffer.resourceIdentity,
      tracked: [{ resource: buffer, identity: buffer.resourceIdentity, subscribe: (cb) => buffer.onDestroy(cb) }]
    };
  }
  #currentUniformValue() {
    const value = this.#uniformValue;
    if (value?.revision === this.#revision && value.bytes === this.#bytes)
      return value;
    return this.#uniformValue = { owner: this.#captureToken, revision: this.#revision, bytes: this.#bytes };
  }
  #ensureLayout(binding, sourceHint) {
    const layout = staticBindingLayout(binding);
    const addressSpace = normalizeAddressSpace(binding.addressSpace);
    if (!this.#state)
      return this.#adoptLayout(binding, layout, addressSpace, sourceHint);
    this.#assertCompatibleLayout(binding, layout, addressSpace, sourceHint);
    return this.#state;
  }
  #adoptLayout(binding, layout, addressSpace, sourceHint) {
    const bytes = writeLayoutValue(layout, this.#values);
    const state = {
      layout,
      layoutSignature: sharedUniformLayoutSignature(layout),
      layoutText: formatSharedUniformLayout(layout),
      sourceHint,
      bindingName: binding.name,
      addressSpace
    };
    const buffer = this.device.createBuffer({
      size: layout.size,
      usage: addressSpace === "storage" ? ["storage", "copy_dst"] : ["uniform", "copy_dst"],
      label: `${binding.name}.sharedUniform`
    });
    try {
      if (addressSpace === "storage")
        buffer.write(bytes, 0);
    } catch (error) {
      buffer.destroy();
      throw error;
    }
    this.#bytes = new Uint8Array(bytes);
    this.#state = state;
    this.#bufferRef = buffer;
    this.#dirty = addressSpace === "uniform";
    return state;
  }
  // Accessors and bundle recording expose a buffer that can be submitted without our hooks.
  // Keep it current from that point on; ordinary managed frame consumers only need CPU bytes.
  #prepareUniform(retain) {
    if (!this.#bufferRef)
      return;
    if (this.#dirty) {
      this.#bufferRef.write(this.#bytes, 0);
      this.#dirty = false;
    }
    if (retain)
      this.#liveUniform = true;
  }
  #assertCompatibleLayout(binding, layout, addressSpace, sourceHint) {
    const state = this.#state;
    if (state.addressSpace !== addressSpace) {
      throw unsupportedError("uniforms", `shared uniforms '${state.bindingName}' already adopted address space ${state.addressSpace}; '${binding.name}' uses ${addressSpace}.`);
    }
    if (sharedUniformLayoutSignature(layout) === state.layoutSignature)
      return;
    throw sharedUniformLayoutMismatchError({
      bindingName: state.bindingName,
      adoptedLayout: state.layoutText,
      adoptedSource: state.sourceHint,
      incomingLayout: formatSharedUniformLayout(layout, { abbreviated: true }),
      incomingSource: sourceHint
    });
  }
  #requiredBuffer() {
    if (!this.#bufferRef)
      throw unsupportedError("uniforms", "shared uniforms have not adopted a layout yet.");
    return this.#bufferRef;
  }
  /**
   * Frees the backing buffer, if the layout was already adopted. Idempotent, and a no-op for an
   * object that no shader ever bound — the buffer only exists after adoption.
   *
   * @internal Lifetime is the gpu's: `gpu.dispose()` runs this in the resource phase.
   */
  destroy() {
    this.#bufferRef?.destroy();
  }
};
function uniforms(gpu, values) {
  const kernel = liveKernel(gpu, "uniforms");
  return ownResource(kernel, new SharedUniformsImpl(kernel.device, values), (shared) => shared.destroy());
}
function ensureBufferBinding(binding) {
  if (binding.bindingLayout?.kind === "buffer")
    return;
  throw unsupportedError("uniforms", `Binding '${binding.name}' does not accept shared uniforms; the shader reflected ${binding.bindingLayout?.kind ?? "none"}.`);
}
function staticBindingLayout(binding) {
  if (!binding.layout)
    throw unsupportedError("uniforms", `Binding '${binding.name}' does not expose a host-shareable layout.`);
  if (binding.layout.size === void 0)
    throw unsupportedError("uniforms", `Binding '${binding.name}' has a runtime-sized layout; it cannot be shared.`);
  return binding.layout;
}
function mergeInto(target2, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (isUnsafeKey(key))
      continue;
    if (isPlainObject2(value) && isPlainObject2(target2[key]))
      mergeInto(target2[key], value);
    else
      target2[key] = cloneValue(value);
  }
}
function cloneRecord(value) {
  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isUnsafeKey(key))
      continue;
    next[key] = cloneValue(entry);
  }
  return next;
}
function isUnsafeKey(key) {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}
function cloneValue(value) {
  if (Array.isArray(value))
    return value.map(cloneValue);
  if (ArrayBuffer.isView(value))
    return cloneTypedArray(value);
  if (isPlainObject2(value))
    return cloneRecord(value);
  return value;
}
function cloneTypedArray(value) {
  if (value instanceof Float32Array)
    return value.slice();
  if (value instanceof Uint32Array)
    return value.slice();
  if (value instanceof Int32Array)
    return value.slice();
  return value;
}
function isPlainObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !ArrayBuffer.isView(value);
}
function normalizeAddressSpace(addressSpace) {
  return addressSpace === "storage" ? "storage" : "uniform";
}

// node_modules/vgpu/dist/index.js
function init(options) {
  return createCoreGpu("browser", options);
}

// src/ShapeWaves.jsx
var SHAPE_MODES = { mixed: 0, squares: 1, circles: 2, triangles: 3 };
var MAX_DPR = 2;
var MAX_MASK_SIZE = 1024;
var NOISE_CELLS = 32;
var TIME_RATE = 0.1;
var SIMULATION_STEP = 1 / 60;
var WAVE_SPEED = 0.42;
var WAVE_FRICTION = 0.94;
var WAVE_DECAY = 0.972;
var SETTLED_THRESHOLD = 0.01;
var INTRO_BAND = 0.2;
var INTRO_WARP = 0.3;
var INTRO_JITTER = 0.16;
var INTRO_END = 1 + INTRO_WARP + INTRO_JITTER + INTRO_BAND;
var NOISE_WGSL = `
fn mod289v3(x: vec3f) -> vec3f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn mod289v4(x: vec4f) -> vec4f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn permute(x: vec4f) -> vec4f { return mod289v4(((x * 34.0) + 10.0) * x); }
fn taylorInvSqrt(r: vec4f) -> vec4f { return 1.79284291400159 - 0.85373472095314 * r; }
fn fadeCurve(t: vec3f) -> vec3f { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

fn cnoise(P: vec3f) -> f32 {
  var Pi0 = floor(P);
  var Pi1 = Pi0 + vec3f(1.0);
  Pi0 = mod289v3(Pi0);
  Pi1 = mod289v3(Pi1);
  let Pf0 = fract(P);
  let Pf1 = Pf0 - vec3f(1.0);
  let ix = vec4f(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  let iy = vec4f(Pi0.yy, Pi1.yy);
  let iz0 = Pi0.zzzz;
  let iz1 = Pi1.zzzz;

  let ixy = permute(permute(ix) + iy);
  let ixy0 = permute(ixy + iz0);
  let ixy1 = permute(ixy + iz1);

  var gx0 = ixy0 * (1.0 / 7.0);
  var gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
  gx0 = fract(gx0);
  let gz0 = vec4f(0.5) - abs(gx0) - abs(gy0);
  let sz0 = step(gz0, vec4f(0.0));
  gx0 -= sz0 * (step(vec4f(0.0), gx0) - 0.5);
  gy0 -= sz0 * (step(vec4f(0.0), gy0) - 0.5);

  var gx1 = ixy1 * (1.0 / 7.0);
  var gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
  gx1 = fract(gx1);
  let gz1 = vec4f(0.5) - abs(gx1) - abs(gy1);
  let sz1 = step(gz1, vec4f(0.0));
  gx1 -= sz1 * (step(vec4f(0.0), gx1) - 0.5);
  gy1 -= sz1 * (step(vec4f(0.0), gy1) - 0.5);

  var g000 = vec3f(gx0.x, gy0.x, gz0.x);
  var g100 = vec3f(gx0.y, gy0.y, gz0.y);
  var g010 = vec3f(gx0.z, gy0.z, gz0.z);
  var g110 = vec3f(gx0.w, gy0.w, gz0.w);
  var g001 = vec3f(gx1.x, gy1.x, gz1.x);
  var g101 = vec3f(gx1.y, gy1.y, gz1.y);
  var g011 = vec3f(gx1.z, gy1.z, gz1.z);
  var g111 = vec3f(gx1.w, gy1.w, gz1.w);

  let norm0 = taylorInvSqrt(vec4f(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
  g000 *= norm0.x;
  g010 *= norm0.y;
  g100 *= norm0.z;
  g110 *= norm0.w;
  let norm1 = taylorInvSqrt(vec4f(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
  g001 *= norm1.x;
  g011 *= norm1.y;
  g101 *= norm1.z;
  g111 *= norm1.w;

  let n000 = dot(g000, Pf0);
  let n100 = dot(g100, vec3f(Pf1.x, Pf0.yz));
  let n010 = dot(g010, vec3f(Pf0.x, Pf1.y, Pf0.z));
  let n110 = dot(g110, vec3f(Pf1.xy, Pf0.z));
  let n001 = dot(g001, vec3f(Pf0.xy, Pf1.z));
  let n101 = dot(g101, vec3f(Pf1.x, Pf0.y, Pf1.z));
  let n011 = dot(g011, vec3f(Pf0.x, Pf1.yz));
  let n111 = dot(g111, Pf1);

  let f = fadeCurve(Pf0);
  let nz = mix(vec4f(n000, n100, n010, n110), vec4f(n001, n101, n011, n111), f.z);
  let ny = mix(nz.xy, nz.zw, f.y);
  return 2.2 * mix(ny.x, ny.y, f.x);
}

fn fbm(p: vec3f) -> f32 {
  var total = 0.0;
  var amplitude = 1.0;
  var weight = 0.0;
  var frequency = 1.0;
  for (var i = 0; i < 2; i++) {
    total += amplitude * cnoise(p * frequency);
    weight += amplitude;
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return total / weight;
}
`;
var SCENE_SHADER = `
struct Params {
  resolution: vec4f,
  placement: vec4f,
  grid: vec4f,
  field: vec4f,
  motion: vec4f,
  color: vec4f,
  hover: vec4f,
  background: vec4f,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var maskTexture: texture_2d<f32>;
@group(0) @binding(2) var maskSampler: sampler;
@group(0) @binding(3) var<storage, read> charges: array<f32>;

const SEED = vec2f(12.9898, 78.233);
const GLOW_THRESHOLD = 0.6;
${NOISE_WGSL}

fn sdIsoscelesTriangle(point: vec2f, q: vec2f) -> f32 {
  let p = vec2f(abs(point.x), point.y);
  let a = p - q * clamp(dot(p, q) / dot(q, q), 0.0, 1.0);
  let b = p - q * vec2f(clamp(p.x / q.x, 0.0, 1.0), 1.0);
  let s = -sign(q.y);
  let d = min(vec2f(dot(a, a), s * (p.x * q.y - p.y * q.x)), vec2f(dot(b, b), s * (p.y - q.y)));
  return -sqrt(d.x) * sign(d.y);
}

fn shapeDistance(p: vec2f, shape: i32, c: f32) -> f32 {
  if (shape == 0) { return max(abs(p.x), abs(p.y)) - c; }
  if (shape == 1) { return length(p) - c; }
  return sdIsoscelesTriangle(vec2f(p.x, p.y + c), vec2f(c, 2.0 * c));
}

fn hash21(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let resolution = params.resolution.xy;
  let cellPx = params.grid.x;
  let dotSize = params.grid.y;
  let mode = i32(params.grid.z + 0.5);
  let cols = i32(params.grid.w + 0.5);
  let background = params.background.rgb;
  let toSurface = params.hover.w < 0.5;

  let pixel = uv * resolution;
  let origin = params.placement.xy;
  let rows = i32(params.placement.z + 0.5);
  let cell = floor((pixel - origin) / cellPx);
  if (cell.y < 0.0 || i32(cell.y) >= rows || cell.x < 0.0 || i32(cell.x) >= cols) {
    return vec4f(background, select(0.0, 1.0, toSurface));
  }
  let center = origin + (cell + 0.5) * cellPx;
  let local = (pixel - center) / (cellPx * 0.5);
  let cellUv = center / resolution;

  if (params.motion.z > 0.5 && textureSampleLevel(maskTexture, maskSampler, cellUv, 0.0).r > 0.5) {
    return vec4f(background, select(0.0, 1.0, toSurface));
  }

  var level = 1.0;
  let fade = params.motion.w;
  if (fade > 0.0) {
    let q = abs(uv * 2.0 - 1.0);
    let radius = pow(pow(q.x, 2.5) + pow(q.y, 2.5), 1.0 / 2.5) / pow(2.0, 1.0 / 2.5);
    level = 1.0 - smoothstep(max(0.0, 1.0 - fade * 2.2), 1.0, radius);
  }
  let noise = fbm(vec3f((center + params.motion.xy) / params.field.x + SEED, params.field.w));
  let tone = clamp((noise * 0.5 + 0.5 - params.field.y) * params.field.z + 0.5, 0.0, 1.0);
  let band = i32(min(tone, 0.999999) * 3.0);

  var charge = 0.0;
  let index = i32(cell.y) * cols + i32(cell.x);
  if (index >= 0 && index < i32(arrayLength(&charges))) { charge = charges[index]; }
  let stepped = (band + i32(clamp(charge, 0.0, 0.999) * 3.0)) % 3;

  var shape = 2 - stepped;
  var size = dotSize;
  if (mode != 0) {
    shape = mode - 1;
    size = dotSize * mix(0.45, 1.0, f32(stepped) / 2.0);
  }
  let introProgress = params.placement.w;
  var front = 0.0;
  if (introProgress < ${INTRO_END.toFixed(2)}) {
    let radial = length((center - resolution * 0.5) / (resolution * 0.5)) * 0.70710678;
    let warp = cnoise(vec3f(cellUv * vec2f(3.2, 2.4) + SEED, 4.7)) * ${INTRO_WARP.toFixed(2)};
    let jitter = hash21(cell) * ${INTRO_JITTER.toFixed(2)};
    let spread = radial + warp + jitter + ${INTRO_WARP.toFixed(2)};
    let band = ${INTRO_BAND.toFixed(2)} * (0.6 + 0.8 * hash21(cell + vec2f(17.0, 9.0)));
    let t = clamp((introProgress - spread) / band, 0.0, 1.0);
    if (t <= 0.0) {
      return vec4f(background, select(0.0, 1.0, toSurface));
    }
    let back = t - 1.0;
    size = max(size * (1.0 + 2.70158 * back * back * back + 1.70158 * back * back), 0.02);
    front = 1.0 - smoothstep(0.0, 1.0, abs(introProgress - spread) / band);
  }
  let aa = 2.0 / cellPx;
  let coverage = smoothstep(aa, -aa, shapeDistance(local, shape, size));

  let tint = mix(params.color.rgb, params.hover.rgb, max(smoothstep(0.15, 0.85, charge), front * 0.35));

  let rgb = mix(background, tint, coverage * level);
  if (toSurface) { return vec4f(rgb, 1.0); }
  let luminance = dot(tint * level, vec3f(0.2126, 0.7152, 0.0722));
  let glow = max(0.0, (luminance - GLOW_THRESHOLD) / (1.0 - GLOW_THRESHOLD)) * coverage;
  return vec4f(rgb, glow);
}
`;
var BLUR_SHADER = `
struct Blur { direction: vec4f }
@group(0) @binding(0) var<uniform> blur: Blur;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var sourceSampler: sampler;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let sigma = blur.direction.z;
  let radius = i32(ceil(3.0 * sigma));
  var sum = vec3f(0.0);
  var weight = 0.0;
  for (var i = -radius; i <= radius; i++) {
    let offset = f32(i);
    let w = exp(-(offset * offset) / (2.0 * sigma * sigma));
    let sample = textureSampleLevel(sourceTexture, sourceSampler, uv + offset * blur.direction.xy, 0.0);
    sum += select(sample.rgb, sample.rgb * sample.a, blur.direction.w > 0.5) * w;
    weight += w;
  }
  return vec4f(sum / weight, 1.0);
}
`;
var COMPOSITE_SHADER = `
struct Composite { strength: vec4f }
@group(0) @binding(0) var<uniform> composite: Composite;
@group(0) @binding(1) var sceneTexture: texture_2d<f32>;
@group(0) @binding(2) var glowTexture: texture_2d<f32>;
@group(0) @binding(3) var linearSampler: sampler;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let scene = textureSampleLevel(sceneTexture, linearSampler, uv, 0.0).rgb;
  let glow = textureSampleLevel(glowTexture, linearSampler, uv, 0.0).rgb;
  return vec4f(scene + glow * composite.strength.x, 1.0);
}
`;
var parseColor = (value, fallback) => {
  const source = typeof value === "string" ? value.trim() : "";
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(source) || /^#?([\da-f]{6})$/i.exec(fallback);
  let hex = match[1];
  if (hex.length === 3) hex = hex.replace(/./g, (char) => char + char);
  return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
};
function ShapeWaves({
  text = "",
  fontFamily = 'Geist, "Geist Sans", system-ui, sans-serif',
  fontWeight = 500,
  textSize = 0.6,
  shapes = "mixed",
  cellSize = 10,
  dotSize = 0.75,
  color = "#929292",
  hoverColor = "#ffffff",
  backgroundColor = "#000000",
  speed = 1,
  scale = 1,
  contrast = 1,
  brightness = 0.4,
  flow = 0,
  direction = 0,
  fade = 0.25,
  interactive = true,
  splashRadius = 40,
  splashStrength = 0.4,
  glow = 0.35,
  intro = true,
  introDuration = 1.6,
  introKey = 0,
  paused = false,
  onError,
  className = ""
}) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const [ready, setReady] = useState(false);
  const settingsRef = useRef(null);
  const applySettingsRef = useRef(() => {
  });
  const applyMaskRef = useRef(() => {
  });
  const onErrorRef = useRef(onError);
  settingsRef.current = {
    text: String(text ?? ""),
    fontFamily,
    fontWeight,
    textSize,
    shapes,
    cellSize: Math.max(2, cellSize),
    dotSize,
    color,
    hoverColor,
    backgroundColor,
    speed,
    scale: Math.max(0.05, scale),
    contrast,
    brightness,
    flow,
    direction,
    fade,
    interactive,
    splashRadius,
    splashStrength,
    glow,
    intro,
    introDuration: Math.max(0.1, introDuration),
    introKey,
    paused
  };
  onErrorRef.current = onError;
  const settingsSignature = [
    shapes,
    cellSize,
    dotSize,
    color,
    hoverColor,
    backgroundColor,
    speed,
    scale,
    contrast,
    brightness,
    flow,
    direction,
    fade,
    interactive,
    splashRadius,
    splashStrength,
    glow,
    intro,
    introDuration,
    paused
  ].join("|");
  const maskSignature = [text, fontFamily, fontWeight, textSize].join("|");
  const replayRef = useRef(() => {
  });
  useEffect(() => {
    applySettingsRef.current();
  }, [settingsSignature]);
  useEffect(() => {
    applyMaskRef.current();
  }, [maskSignature]);
  useEffect(() => {
    if (introKey) replayRef.current();
  }, [introKey]);
  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return void 0;
    let disposed2 = false;
    let failed = false;
    let gpu;
    let maskTexture;
    let chargeBuffer;
    let frameId = 0;
    let lastFrameTime = 0;
    let time = 0;
    let drift = [0, 0];
    let dpr = 1;
    let visible = true;
    let presented = false;
    let cols = 1;
    let rows = 1;
    let cellPx = 10;
    let gridOrigin = [0, 0];
    let charges = new Float32Array(1);
    let heights = new Float32Array(1);
    let previousHeights = new Float32Array(1);
    let simulationBacklog = 0;
    let introStart = 0;
    let introProgress = INTRO_END;
    let introArmed = false;
    let chargesActive = false;
    let bounds = null;
    let unsubscribeGpuError;
    let resizeObserver;
    let visibilityObserver;
    let wakeRenderer = () => {
    };
    const pointer = { x: 0, y: 0, at: 0, inside: false };
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const maskCanvas = document.createElement("canvas");
    const maskContext = maskCanvas.getContext("2d");
    const handleWake = () => wakeRenderer();
    const invalidateBounds = () => {
      bounds = null;
    };
    const splash = (x, y, strength) => {
      const settings = settingsRef.current;
      const sigma = Math.max(0.5, settings.splashRadius * dpr / cellPx * 0.5);
      const reach = Math.ceil(sigma * 2.5);
      const centerCol = (x * dpr - gridOrigin[0]) / cellPx - 0.5;
      const centerRow = (y * dpr - gridOrigin[1]) / cellPx - 0.5;
      const minRow = Math.max(0, Math.floor(centerRow - reach));
      const maxRow = Math.min(rows - 1, Math.ceil(centerRow + reach));
      const minCol = Math.max(0, Math.floor(centerCol - reach));
      const maxCol = Math.min(cols - 1, Math.ceil(centerCol + reach));
      for (let row = minRow; row <= maxRow; row++) {
        const dy = row - centerRow;
        for (let col = minCol; col <= maxCol; col++) {
          const dx = col - centerCol;
          const bump = strength * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
          const index = row * cols + col;
          heights[index] = Math.min(1.2, heights[index] + bump);
        }
      }
      chargesActive = true;
    };
    const handlePointerMove = (event) => {
      if (!settingsRef.current.interactive) return;
      if (!bounds) bounds = root.getBoundingClientRect();
      const now = performance.now();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      const inside = x >= 0 && y >= 0 && x <= bounds.width && y <= bounds.height;
      if (inside) {
        const elapsed = pointer.inside ? Math.max(8, now - pointer.at) : 16;
        const travelled = pointer.inside ? Math.hypot(x - pointer.x, y - pointer.y) : 0;
        const speed2 = travelled / elapsed * 1e3;
        splash(x, y, Math.min(1, 0.22 + speed2 * 6e-4) * settingsRef.current.splashStrength);
        wakeRenderer();
      }
      pointer.x = x;
      pointer.y = y;
      pointer.at = now;
      pointer.inside = inside;
    };
    const reportFailure = (error) => {
      if (disposed2 || failed) return;
      failed = true;
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
      resizeObserver?.disconnect();
      visibilityObserver?.disconnect();
      unsubscribeGpuError?.();
      applySettingsRef.current = () => {
      };
      applyMaskRef.current = () => {
      };
      const failedGpu = gpu;
      gpu = void 0;
      failedGpu?.dispose();
      setReady(false);
      onErrorRef.current?.(error instanceof Error ? error : new Error(String(error)));
    };
    const measureSurface = () => {
      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      return [Math.max(1, Math.round(canvas.clientWidth * dpr)), Math.max(1, Math.round(canvas.clientHeight * dpr))];
    };
    void (async () => {
      try {
        gpu = await init({ powerPreference: "low-power" });
        if (disposed2) return gpu.dispose();
        unsubscribeGpuError = gpu.onError(reportFailure);
        const initialSize = measureSurface();
        const outputFormat = navigator.gpu.getPreferredCanvasFormat();
        const output = surface(gpu, canvas, { dpr, size: initialSize, autoResize: false, format: outputFormat });
        const params = uniforms(gpu, {
          resolution: [initialSize[0], initialSize[1], 1 / initialSize[0], 1 / initialSize[1]],
          placement: [0, 0, 1, 0],
          grid: [10, 0.75, 0, 1],
          field: [320, 0.5, 2.8, 0],
          motion: [0, 0, 0, 0.25],
          color: [0.573, 0.573, 0.573, 1],
          hover: [1, 1, 1, 0],
          background: [0, 0, 0, 1]
        });
        const linearSampler = sampler(gpu, {
          minFilter: "linear",
          magFilter: "linear",
          addressModeU: "clamp-to-edge",
          addressModeV: "clamp-to-edge"
        });
        const createMaskTexture = (maskWidth, maskHeight) => gpu.device.createTexture({
          size: [maskWidth, maskHeight],
          format: "rgba8unorm",
          usage: ["texture_binding", "copy_dst", "render_attachment"],
          label: "shape-waves-mask"
        });
        maskTexture = createMaskTexture(1, 1);
        chargeBuffer = storage(gpu, 4, "read");
        chargeBuffer.write(charges);
        const scene = effect(gpu, SCENE_SHADER, {
          label: "shape-waves-scene",
          set: { params, maskTexture, maskSampler: linearSampler, charges: chargeBuffer }
        });
        const sceneTarget = target(gpu, { size: initialSize, format: "rgba8unorm", label: "shape-waves-scene" });
        const glowSize = (size) => [Math.max(1, Math.ceil(size[0] / 2)), Math.max(1, Math.ceil(size[1] / 2))];
        const glowA = target(gpu, { size: glowSize(initialSize), format: "rgba8unorm", label: "shape-waves-glow-a" });
        const glowB = target(gpu, { size: glowSize(initialSize), format: "rgba8unorm", label: "shape-waves-glow-b" });
        const blurParamsX = uniforms(gpu, { direction: [0, 0, 4, 1] });
        const blurParamsY = uniforms(gpu, { direction: [0, 0, 4, 0] });
        const blurX = effect(gpu, BLUR_SHADER, {
          label: "shape-waves-glow-x",
          set: { blur: blurParamsX, sourceTexture: sceneTarget, sourceSampler: linearSampler }
        });
        const blurY = effect(gpu, BLUR_SHADER, {
          label: "shape-waves-glow-y",
          set: { blur: blurParamsY, sourceTexture: glowA, sourceSampler: linearSampler }
        });
        const compositeParams = uniforms(gpu, { strength: [2, 0, 0, 0] });
        const composite = effect(gpu, COMPOSITE_SHADER, {
          label: "shape-waves-composite",
          set: { composite: compositeParams, sceneTexture: sceneTarget, glowTexture: glowB, linearSampler }
        });
        await Promise.all([
          scene.compile({ colors: [outputFormat] }),
          scene.compile(sceneTarget),
          blurX.compile(glowA),
          blurY.compile(glowB),
          composite.compile({ colors: [outputFormat] })
        ]);
        if (disposed2) return;
        const glowEnabled = () => settingsRef.current.glow > 0;
        let lastIntro = false;
        const configureGrid = () => {
          const settings = settingsRef.current;
          const [width, height] = output.size;
          const nextCols = Math.max(1, Math.round(width / (settings.cellSize * dpr)));
          cellPx = width / nextCols;
          const nextRows = Math.max(1, Math.floor(height / cellPx));
          gridOrigin = [0, (height - nextRows * cellPx) / 2];
          if (nextCols === cols && nextRows === rows && charges.length === cols * rows) return;
          cols = nextCols;
          rows = nextRows;
          charges = new Float32Array(cols * rows);
          heights = new Float32Array(cols * rows);
          previousHeights = new Float32Array(cols * rows);
          chargesActive = false;
          const nextBuffer = storage(gpu, charges.byteLength, "read");
          nextBuffer.write(charges);
          scene.set({ charges: nextBuffer });
          chargeBuffer.destroy();
          chargeBuffer = nextBuffer;
        };
        const stepRipples = () => {
          const lastCol = cols - 1;
          const lastRow = rows - 1;
          let peak = 0;
          for (let row = 0; row < rows; row++) {
            const up = (row === 0 ? row : row - 1) * cols;
            const down = (row === lastRow ? row : row + 1) * cols;
            const base = row * cols;
            for (let col = 0; col < cols; col++) {
              const index = base + col;
              const left = base + (col === 0 ? col : col - 1);
              const right = base + (col === lastCol ? col : col + 1);
              const height = heights[index];
              const laplacian = heights[left] + heights[right] + heights[up + col] + heights[down + col] - 4 * height;
              const velocity = (height - previousHeights[index]) * WAVE_FRICTION;
              const next = (height + velocity + WAVE_SPEED * laplacian) * WAVE_DECAY;
              previousHeights[index] = next;
              const charge = Math.min(1, Math.max(0, next));
              charges[index] = charge;
              if (charge > peak) peak = charge;
            }
          }
          const swap = heights;
          heights = previousHeights;
          previousHeights = swap;
          return peak;
        };
        const updateCharges = (deltaSeconds) => {
          if (!chargesActive) return false;
          simulationBacklog = Math.min(simulationBacklog + deltaSeconds, SIMULATION_STEP * 4);
          let peak = 1;
          while (simulationBacklog >= SIMULATION_STEP) {
            simulationBacklog -= SIMULATION_STEP;
            peak = stepRipples();
          }
          if (peak < SETTLED_THRESHOLD) {
            heights.fill(0);
            previousHeights.fill(0);
            charges.fill(0);
            chargesActive = false;
          }
          chargeBuffer.write(charges);
          return chargesActive;
        };
        const isAnimating = () => {
          const settings = settingsRef.current;
          return visible && !document.hidden && !settings.paused && settings.speed > 0 && !reduceMotion.matches;
        };
        const render = (now) => {
          frameId = 0;
          if (disposed2 || failed) return;
          const settings = settingsRef.current;
          const deltaSeconds = lastFrameTime ? Math.min(0.1, (now - lastFrameTime) / 1e3) : 0;
          lastFrameTime = now;
          const animating = isAnimating();
          if (animating) {
            time += deltaSeconds * TIME_RATE * settings.speed;
            const angle = settings.direction * Math.PI / 180;
            const distance = settings.flow * cellPx * deltaSeconds;
            drift = [drift[0] + Math.cos(angle) * distance, drift[1] + Math.sin(angle) * distance];
          }
          const hovering = visible && !document.hidden && updateCharges(deltaSeconds);
          if (introArmed) {
            introArmed = false;
            introStart = now;
            introProgress = 0;
          }
          const introPlaying = introProgress < INTRO_END;
          if (introPlaying) {
            introProgress = Math.min(INTRO_END, (now - introStart) / 1e3 / settings.introDuration * INTRO_END);
          }
          params.set({ placement: [gridOrigin[0], gridOrigin[1], rows, introProgress] });
          params.set({
            field: [
              NOISE_CELLS * cellPx * settings.scale,
              0.5 - (settings.brightness - 0.5) * 0.4,
              2.8 * settings.contrast,
              time
            ]
          });
          params.set({ motion: [drift[0], drift[1], settings.text.trim() ? 1 : 0, settings.fade] });
          try {
            frame(gpu, (currentFrame) => {
              if (!glowEnabled()) {
                currentFrame.pass(output, scene);
                return;
              }
              currentFrame.pass(sceneTarget, scene);
              currentFrame.pass(glowA, blurX);
              currentFrame.pass(glowB, blurY);
              currentFrame.pass(output, composite);
            });
          } catch (error) {
            reportFailure(error);
            return;
          }
          if (!presented) {
            presented = true;
            setReady(true);
          }
          if (animating || hovering || introPlaying) frameId = requestAnimationFrame(render);
          else lastFrameTime = 0;
        };
        wakeRenderer = () => {
          if (disposed2 || failed || frameId) return;
          frameId = requestAnimationFrame(render);
        };
        const drawMask = () => {
          const settings = settingsRef.current;
          const content = settings.text.trim();
          const [surfaceWidth, surfaceHeight] = output.size;
          const hasText = content.length > 0;
          const maskScale = hasText ? Math.min(1, MAX_MASK_SIZE / Math.max(surfaceWidth, surfaceHeight)) : 0;
          const maskWidth = hasText ? Math.max(1, Math.round(surfaceWidth * maskScale)) : 1;
          const maskHeight = hasText ? Math.max(1, Math.round(surfaceHeight * maskScale)) : 1;
          maskCanvas.width = maskWidth;
          maskCanvas.height = maskHeight;
          maskContext.fillStyle = "#000";
          maskContext.fillRect(0, 0, maskWidth, maskHeight);
          if (hasText) {
            let fontPx = Math.max(1, settings.textSize * maskHeight);
            maskContext.font = `${settings.fontWeight} ${fontPx}px ${settings.fontFamily}`;
            const measured = maskContext.measureText(content).width;
            const maxWidth = maskWidth * 0.9;
            if (measured > maxWidth) {
              fontPx = Math.max(1, fontPx * maxWidth / measured);
              maskContext.font = `${settings.fontWeight} ${fontPx}px ${settings.fontFamily}`;
            }
            maskContext.textAlign = "center";
            maskContext.textBaseline = "alphabetic";
            const metrics = maskContext.measureText(content);
            const x = (maskWidth + metrics.actualBoundingBoxLeft - metrics.actualBoundingBoxRight) / 2;
            const y = (maskHeight + metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
            maskContext.fillStyle = "#fff";
            maskContext.fillText(content, x, y);
          }
          const nextTexture = createMaskTexture(maskWidth, maskHeight);
          gpu.gpu.queue.copyExternalImageToTexture({ source: maskCanvas }, { texture: nextTexture.gpu }, [
            maskWidth,
            maskHeight
          ]);
          scene.set({ maskTexture: nextTexture });
          maskTexture.destroy();
          maskTexture = nextTexture;
        };
        const applySettings = () => {
          if (disposed2 || failed) return;
          const settings = settingsRef.current;
          configureGrid();
          params.set({
            placement: [gridOrigin[0], gridOrigin[1], rows, introProgress],
            grid: [cellPx, Math.min(1, Math.max(0.1, settings.dotSize)), SHAPE_MODES[settings.shapes] ?? 0, cols],
            color: [...parseColor(settings.color, "#929292"), 1],
            hover: [...parseColor(settings.hoverColor, "#ffffff"), glowEnabled() ? 1 : 0],
            background: [...parseColor(settings.backgroundColor, "#000000"), 1]
          });
          compositeParams.set({ strength: [2 * settings.glow, 0, 0, 0] });
          if (settings.intro !== lastIntro) {
            lastIntro = settings.intro;
            if (settings.intro && !reduceMotion.matches) introArmed = true;
          }
          if (!settings.interactive && chargesActive) {
            heights.fill(0);
            previousHeights.fill(0);
            charges.fill(0);
            chargesActive = false;
            chargeBuffer.write(charges);
          }
          wakeRenderer();
        };
        const applyMask = () => {
          if (disposed2 || failed) return;
          drawMask();
          applySettings();
          const settings = settingsRef.current;
          if (!settings.text.trim() || !document.fonts?.load) return;
          document.fonts.load(`${settings.fontWeight} 32px ${settings.fontFamily}`).then(() => {
            if (disposed2 || failed) return;
            drawMask();
            wakeRenderer();
          }).catch(() => {
          });
        };
        const resize = () => {
          if (disposed2 || failed) return;
          invalidateBounds();
          const nextSize = measureSurface();
          if (nextSize[0] !== output.size[0] || nextSize[1] !== output.size[1]) output.resize(nextSize);
          const [width, height] = output.size;
          sceneTarget.resize([width, height]);
          const half = glowSize([width, height]);
          glowA.resize(half);
          glowB.resize(half);
          blurParamsX.set({ direction: [1 / half[0], 0, 4, 1] });
          blurParamsY.set({ direction: [0, 1 / half[1], 4, 0] });
          params.set({ resolution: [width, height, 1 / width, 1 / height] });
          drawMask();
          applySettings();
        };
        applySettingsRef.current = applySettings;
        applyMaskRef.current = applyMask;
        replayRef.current = () => {
          if (disposed2 || failed || !settingsRef.current.intro || reduceMotion.matches) return;
          introArmed = true;
          wakeRenderer();
        };
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(root);
        visibilityObserver = new IntersectionObserver(
          (entries) => {
            visible = entries.some((entry) => entry.isIntersecting);
            if (visible) wakeRenderer();
          },
          { threshold: 0 }
        );
        visibilityObserver.observe(root);
        document.addEventListener("visibilitychange", handleWake);
        reduceMotion.addEventListener("change", handleWake);
        window.addEventListener("pointermove", handlePointerMove, { passive: true });
        window.addEventListener("scroll", invalidateBounds, { capture: true, passive: true });
        resize();
        applyMask();
      } catch (error) {
        reportFailure(error);
      }
    })();
    return () => {
      disposed2 = true;
      wakeRenderer = () => {
      };
      applySettingsRef.current = () => {
      };
      applyMaskRef.current = () => {
      };
      replayRef.current = () => {
      };
      document.removeEventListener("visibilitychange", handleWake);
      reduceMotion.removeEventListener("change", handleWake);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("scroll", invalidateBounds, { capture: true });
      resizeObserver?.disconnect();
      visibilityObserver?.disconnect();
      unsubscribeGpuError?.();
      if (frameId) cancelAnimationFrame(frameId);
      maskTexture?.destroy();
      chargeBuffer?.destroy();
      gpu?.dispose();
    };
  }, []);
  return /* @__PURE__ */ h(
    "div",
    {
      ref: rootRef,
      className: `shape-waves ${className}`,
      "data-ready": ready,
      style: { backgroundColor },
      "aria-hidden": "true"
    },
    /* @__PURE__ */ h("canvas", { ref: canvasRef, className: "shape-waves__canvas" })
  );
}

// entries/ShapeWaves.js
var ShapeWaves_default = (el, props) => mount(ShapeWaves, el, props);
export {
  ShapeWaves_default as default
};
