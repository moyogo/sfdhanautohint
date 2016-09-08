module.exports = function () {
	var Module;
	if (!Module) Module = (typeof Module !== "undefined" ? Module : null) || {};
	var moduleOverrides = {};
	for (var key in Module) {
		if (Module.hasOwnProperty(key)) {
			moduleOverrides[key] = Module[key];
		}
	}
	var ENVIRONMENT_IS_WEB = typeof window === "object";
	var ENVIRONMENT_IS_NODE = typeof process === "object" && typeof require === "function" && !ENVIRONMENT_IS_WEB;
	var ENVIRONMENT_IS_WORKER = typeof importScripts === "function";
	var ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;
	if (ENVIRONMENT_IS_NODE) {
		if (!Module["print"]) Module["print"] = function print(x) {
			process["stdout"].write(x + "\n");
		};
		if (!Module["printErr"]) Module["printErr"] = function printErr(x) {
			process["stderr"].write(x + "\n");
		};
		var nodeFS = require("fs");
		var nodePath = require("path");
		Module["read"] = function read(filename, binary) {
			filename = nodePath["normalize"](filename);
			var ret = nodeFS["readFileSync"](filename);
			if (!ret && filename != nodePath["resolve"](filename)) {
				filename = path.join(__dirname, "..", "src", filename);
				ret = nodeFS["readFileSync"](filename);
			}
			if (ret && !binary) ret = ret.toString();
			return ret;
		};
		Module["readBinary"] = function readBinary(filename) {
			return Module["read"](filename, true);
		};
		Module["load"] = function load(f) {
			globalEval(read(f));
		};
		if (!Module["thisProgram"]) {
			if (process["argv"].length > 1) {
				Module["thisProgram"] = process["argv"][1].replace(/\\/g, "/");
			} else {
				Module["thisProgram"] = "unknown-program";
			}
		}
		Module["arguments"] = process["argv"].slice(2);
		if (typeof module !== "undefined") {
			module["exports"] = Module;
		}
		process["on"]("uncaughtException", function (ex) {
			if (!(ex instanceof ExitStatus)) {
				throw ex;
			}
		});
	} else if (ENVIRONMENT_IS_SHELL) {
		if (!Module["print"]) Module["print"] = print;
		if (typeof printErr != "undefined") Module["printErr"] = printErr;
		if (typeof read != "undefined") {
			Module["read"] = read;
		} else {
			Module["read"] = function read() {
				throw "no read() available (jsc?)";
			};
		}
		Module["readBinary"] = function readBinary(f) {
			if (typeof readbuffer === "function") {
				return new Uint8Array(readbuffer(f));
			}
			var data = read(f, "binary");
			assert(typeof data === "object");
			return data;
		};
		if (typeof scriptArgs != "undefined") {
			Module["arguments"] = scriptArgs;
		} else if (typeof arguments != "undefined") {
			Module["arguments"] = arguments;
		}
	} else if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
		Module["read"] = function read(url) {
			var xhr = new XMLHttpRequest();
			xhr.open("GET", url, false);
			xhr.send(null);
			return xhr.responseText;
		};
		if (typeof arguments != "undefined") {
			Module["arguments"] = arguments;
		}
		if (typeof console !== "undefined") {
			if (!Module["print"]) Module["print"] = function print(x) {
				console.log(x);
			};
			if (!Module["printErr"]) Module["printErr"] = function printErr(x) {
				console.log(x);
			};
		} else {
			var TRY_USE_DUMP = false;
			if (!Module["print"]) Module["print"] = TRY_USE_DUMP && typeof dump !== "undefined" ? function (x) {
				dump(x);
			} : function (x) { };
		}
		if (ENVIRONMENT_IS_WORKER) {
			Module["load"] = importScripts;
		}
		if (typeof Module["setWindowTitle"] === "undefined") {
			Module["setWindowTitle"] = function (title) {
				document.title = title;
			};
		}
	} else {
		throw "Unknown runtime environment. Where are we?";
	}
	function globalEval(x) {
		eval.call(null, x);
	}
	if (!Module["load"] && Module["read"]) {
		Module["load"] = function load(f) {
			globalEval(Module["read"](f));
		};
	}
	if (!Module["print"]) {
		Module["print"] = function () { };
	}
	if (!Module["printErr"]) {
		Module["printErr"] = Module["print"];
	}
	if (!Module["arguments"]) {
		Module["arguments"] = [];
	}
	if (!Module["thisProgram"]) {
		Module["thisProgram"] = "./this.program";
	}
	Module.print = Module["print"];
	Module.printErr = Module["printErr"];
	Module["preRun"] = [];
	Module["postRun"] = [];
	for (var key in moduleOverrides) {
		if (moduleOverrides.hasOwnProperty(key)) {
			Module[key] = moduleOverrides[key];
		}
	}
	var Runtime = {
		setTempRet0: function (value) {
			tempRet0 = value;
		},
		getTempRet0: function () {
			return tempRet0;
		},
		stackSave: function () {
			return STACKTOP;
		},
		stackRestore: function (stackTop) {
			STACKTOP = stackTop;
		},
		getNativeTypeSize: function (type) {
			switch (type) {
				case "i1":
				case "i8":
					return 1;

				case "i16":
					return 2;

				case "i32":
					return 4;

				case "i64":
					return 8;

				case "float":
					return 4;

				case "double":
					return 8;

				default:
					{
						if (type[type.length - 1] === "*") {
							return Runtime.QUANTUM_SIZE;
						} else if (type[0] === "i") {
							var bits = parseInt(type.substr(1));
							assert(bits % 8 === 0);
							return bits / 8;
						} else {
							return 0;
						}
					}
			}
		},
		getNativeFieldSize: function (type) {
			return Math.max(Runtime.getNativeTypeSize(type), Runtime.QUANTUM_SIZE);
		},
		STACK_ALIGN: 16,
		prepVararg: function (ptr, type) {
			if (type === "double" || type === "i64") {
				if (ptr & 7) {
					assert((ptr & 7) === 4);
					ptr += 4;
				}
			} else {
				assert((ptr & 3) === 0);
			}
			return ptr;
		},
		getAlignSize: function (type, size, vararg) {
			if (!vararg && (type == "i64" || type == "double")) return 8;
			if (!type) return Math.min(size, 8);
			return Math.min(size || (type ? Runtime.getNativeFieldSize(type) : 0), Runtime.QUANTUM_SIZE);
		},
		dynCall: function (sig, ptr, args) {
			if (args && args.length) {
				if (!args.splice) args = Array.prototype.slice.call(args);
				args.splice(0, 0, ptr);
				return Module["dynCall_" + sig].apply(null, args);
			} else {
				return Module["dynCall_" + sig].call(null, ptr);
			}
		},
		functionPointers: [],
		addFunction: function (func) {
			for (var i = 0; i < Runtime.functionPointers.length; i++) {
				if (!Runtime.functionPointers[i]) {
					Runtime.functionPointers[i] = func;
					return 2 * (1 + i);
				}
			}
			throw "Finished up all reserved function pointers. Use a higher value for RESERVED_FUNCTION_POINTERS.";
		},
		removeFunction: function (index) {
			Runtime.functionPointers[(index - 2) / 2] = null;
		},
		warnOnce: function (text) {
			if (!Runtime.warnOnce.shown) Runtime.warnOnce.shown = {};
			if (!Runtime.warnOnce.shown[text]) {
				Runtime.warnOnce.shown[text] = 1;
				Module.printErr(text);
			}
		},
		funcWrappers: {},
		getFuncWrapper: function (func, sig) {
			assert(sig);
			if (!Runtime.funcWrappers[sig]) {
				Runtime.funcWrappers[sig] = {};
			}
			var sigCache = Runtime.funcWrappers[sig];
			if (!sigCache[func]) {
				sigCache[func] = function dynCall_wrapper() {
					return Runtime.dynCall(sig, func, arguments);
				};
			}
			return sigCache[func];
		},
		getCompilerSetting: function (name) {
			throw "You must build with -s RETAIN_COMPILER_SETTINGS=1 for Runtime.getCompilerSetting or emscripten_get_compiler_setting to work";
		},
		stackAlloc: function (size) {
			var ret = STACKTOP;
			STACKTOP = STACKTOP + size | 0;
			STACKTOP = STACKTOP + 15 & -16;
			return ret;
		},
		staticAlloc: function (size) {
			var ret = STATICTOP;
			STATICTOP = STATICTOP + size | 0;
			STATICTOP = STATICTOP + 15 & -16;
			return ret;
		},
		dynamicAlloc: function (size) {
			var ret = DYNAMICTOP;
			DYNAMICTOP = DYNAMICTOP + size | 0;
			DYNAMICTOP = DYNAMICTOP + 15 & -16;
			if (DYNAMICTOP >= TOTAL_MEMORY) {
				var success = enlargeMemory();
				if (!success) {
					DYNAMICTOP = ret;
					return 0;
				}
			}
			return ret;
		},
		alignMemory: function (size, quantum) {
			var ret = size = Math.ceil(size / (quantum ? quantum : 16)) * (quantum ? quantum : 16);
			return ret;
		},
		makeBigInt: function (low, high, unsigned) {
			var ret = unsigned ? +(low >>> 0) + +(high >>> 0) * +4294967296 : +(low >>> 0) + +(high | 0) * +4294967296;
			return ret;
		},
		GLOBAL_BASE: 8,
		QUANTUM_SIZE: 4,
		__dummy__: 0
	};
	Module["Runtime"] = Runtime;
	var __THREW__ = 0;
	var ABORT = false;
	var EXITSTATUS = 0;
	var undef = 0;
	var tempValue, tempInt, tempBigInt, tempInt2, tempBigInt2, tempPair, tempBigIntI, tempBigIntR, tempBigIntS, tempBigIntP, tempBigIntD, tempDouble, tempFloat;
	var tempI64, tempI64b;
	var tempRet0, tempRet1, tempRet2, tempRet3, tempRet4, tempRet5, tempRet6, tempRet7, tempRet8, tempRet9;
	function assert(condition, text) {
		if (!condition) {
			abort("Assertion failed: " + text);
		}
	}
	var globalScope = this;
	function getCFunc(ident) {
		var func = Module["_" + ident];
		if (!func) {
			try {
				func = eval("_" + ident);
			} catch (e) { }
		}
		assert(func, "Cannot call unknown function " + ident + " (perhaps LLVM optimizations or closure removed it?)");
		return func;
	}
	var cwrap, ccall;
	(function () {
		var JSfuncs = {
			stackSave: function () {
				Runtime.stackSave();
			},
			stackRestore: function () {
				Runtime.stackRestore();
			},
			arrayToC: function (arr) {
				var ret = Runtime.stackAlloc(arr.length);
				writeArrayToMemory(arr, ret);
				return ret;
			},
			stringToC: function (str) {
				var ret = 0;
				if (str !== null && str !== undefined && str !== 0) {
					ret = Runtime.stackAlloc((str.length << 2) + 1);
					writeStringToMemory(str, ret);
				}
				return ret;
			}
		};
		var toC = {
			string: JSfuncs["stringToC"],
			array: JSfuncs["arrayToC"]
		};
		ccall = function ccallFunc(ident, returnType, argTypes, args, opts) {
			var func = getCFunc(ident);
			var cArgs = [];
			var stack = 0;
			if (args) {
				for (var i = 0; i < args.length; i++) {
					var converter = toC[argTypes[i]];
					if (converter) {
						if (stack === 0) stack = Runtime.stackSave();
						cArgs[i] = converter(args[i]);
					} else {
						cArgs[i] = args[i];
					}
				}
			}
			var ret = func.apply(null, cArgs);
			if (returnType === "string") ret = Pointer_stringify(ret);
			if (stack !== 0) {
				if (opts && opts.async) {
					EmterpreterAsync.asyncFinalizers.push(function () {
						Runtime.stackRestore(stack);
					});
					return;
				}
				Runtime.stackRestore(stack);
			}
			return ret;
		};
		var sourceRegex = /^function\s*\(([^)]*)\)\s*{\s*([^*]*?)[\s;]*(?:return\s*(.*?)[;\s]*)?}$/;
		function parseJSFunc(jsfunc) {
			var parsed = jsfunc.toString().match(sourceRegex).slice(1);
			return {
				arguments: parsed[0],
				body: parsed[1],
				returnValue: parsed[2]
			};
		}
		var JSsource = {};
		for (var fun in JSfuncs) {
			if (JSfuncs.hasOwnProperty(fun)) {
				JSsource[fun] = parseJSFunc(JSfuncs[fun]);
			}
		}
		cwrap = function cwrap(ident, returnType, argTypes) {
			argTypes = argTypes || [];
			var cfunc = getCFunc(ident);
			var numericArgs = argTypes.every(function (type) {
				return type === "number";
			});
			var numericRet = returnType !== "string";
			if (numericRet && numericArgs) {
				return cfunc;
			}
			var argNames = argTypes.map(function (x, i) {
				return "$" + i;
			});
			var funcstr = "(function(" + argNames.join(",") + ") {";
			var nargs = argTypes.length;
			if (!numericArgs) {
				funcstr += "var stack = " + JSsource["stackSave"].body + ";";
				for (var i = 0; i < nargs; i++) {
					var arg = argNames[i], type = argTypes[i];
					if (type === "number") continue;
					var convertCode = JSsource[type + "ToC"];
					funcstr += "var " + convertCode.arguments + " = " + arg + ";";
					funcstr += convertCode.body + ";";
					funcstr += arg + "=" + convertCode.returnValue + ";";
				}
			}
			var cfuncname = parseJSFunc(function () {
				return cfunc;
			}).returnValue;
			funcstr += "var ret = " + cfuncname + "(" + argNames.join(",") + ");";
			if (!numericRet) {
				var strgfy = parseJSFunc(function () {
					return Pointer_stringify;
				}).returnValue;
				funcstr += "ret = " + strgfy + "(ret);";
			}
			if (!numericArgs) {
				funcstr += JSsource["stackRestore"].body.replace("()", "(stack)") + ";";
			}
			funcstr += "return ret})";
			return eval(funcstr);
		};
	})();
	Module["cwrap"] = cwrap;
	Module["ccall"] = ccall;
	function setValue(ptr, value, type, noSafe) {
		type = type || "i8";
		if (type.charAt(type.length - 1) === "*") type = "i32";
		switch (type) {
			case "i1":
				HEAP8[ptr >> 0] = value;
				break;

			case "i8":
				HEAP8[ptr >> 0] = value;
				break;

			case "i16":
				HEAP16[ptr >> 1] = value;
				break;

			case "i32":
				HEAP32[ptr >> 2] = value;
				break;

			case "i64":
				tempI64 = [value >>> 0, (tempDouble = value, +Math_abs(tempDouble) >= +1 ? tempDouble > +0 ? (Math_min(+Math_floor(tempDouble / +4294967296), +4294967295) | 0) >>> 0 : ~~+Math_ceil((tempDouble - +(~~tempDouble >>> 0)) / +4294967296) >>> 0 : 0)],
					HEAP32[ptr >> 2] = tempI64[0], HEAP32[ptr + 4 >> 2] = tempI64[1];
				break;

			case "float":
				HEAPF32[ptr >> 2] = value;
				break;

			case "double":
				HEAPF64[ptr >> 3] = value;
				break;

			default:
				abort("invalid type for setValue: " + type);
		}
	}
	Module["setValue"] = setValue;
	function getValue(ptr, type, noSafe) {
		type = type || "i8";
		if (type.charAt(type.length - 1) === "*") type = "i32";
		switch (type) {
			case "i1":
				return HEAP8[ptr >> 0];

			case "i8":
				return HEAP8[ptr >> 0];

			case "i16":
				return HEAP16[ptr >> 1];

			case "i32":
				return HEAP32[ptr >> 2];

			case "i64":
				return HEAP32[ptr >> 2];

			case "float":
				return HEAPF32[ptr >> 2];

			case "double":
				return HEAPF64[ptr >> 3];

			default:
				abort("invalid type for setValue: " + type);
		}
		return null;
	}
	Module["getValue"] = getValue;
	var ALLOC_NORMAL = 0;
	var ALLOC_STACK = 1;
	var ALLOC_STATIC = 2;
	var ALLOC_DYNAMIC = 3;
	var ALLOC_NONE = 4;
	Module["ALLOC_NORMAL"] = ALLOC_NORMAL;
	Module["ALLOC_STACK"] = ALLOC_STACK;
	Module["ALLOC_STATIC"] = ALLOC_STATIC;
	Module["ALLOC_DYNAMIC"] = ALLOC_DYNAMIC;
	Module["ALLOC_NONE"] = ALLOC_NONE;
	function allocate(slab, types, allocator, ptr) {
		var zeroinit, size;
		if (typeof slab === "number") {
			zeroinit = true;
			size = slab;
		} else {
			zeroinit = false;
			size = slab.length;
		}
		var singleType = typeof types === "string" ? types : null;
		var ret;
		if (allocator == ALLOC_NONE) {
			ret = ptr;
		} else {
			ret = [_malloc, Runtime.stackAlloc, Runtime.staticAlloc, Runtime.dynamicAlloc][allocator === undefined ? ALLOC_STATIC : allocator](Math.max(size, singleType ? 1 : types.length));
		}
		if (zeroinit) {
			var ptr = ret, stop;
			assert((ret & 3) == 0);
			stop = ret + (size & ~3);
			for (; ptr < stop; ptr += 4) {
				HEAP32[ptr >> 2] = 0;
			}
			stop = ret + size;
			while (ptr < stop) {
				HEAP8[ptr++ >> 0] = 0;
			}
			return ret;
		}
		if (singleType === "i8") {
			if (slab.subarray || slab.slice) {
				HEAPU8.set(slab, ret);
			} else {
				HEAPU8.set(new Uint8Array(slab), ret);
			}
			return ret;
		}
		var i = 0, type, typeSize, previousType;
		while (i < size) {
			var curr = slab[i];
			if (typeof curr === "function") {
				curr = Runtime.getFunctionIndex(curr);
			}
			type = singleType || types[i];
			if (type === 0) {
				i++;
				continue;
			}
			if (type == "i64") type = "i32";
			setValue(ret + i, curr, type);
			if (previousType !== type) {
				typeSize = Runtime.getNativeTypeSize(type);
				previousType = type;
			}
			i += typeSize;
		}
		return ret;
	}
	Module["allocate"] = allocate;
	function Pointer_stringify(ptr, length) {
		if (length === 0 || !ptr) return "";
		var hasUtf = 0;
		var t;
		var i = 0;
		while (1) {
			t = HEAPU8[ptr + i >> 0];
			hasUtf |= t;
			if (t == 0 && !length) break;
			i++;
			if (length && i == length) break;
		}
		if (!length) length = i;
		var ret = "";
		if (hasUtf < 128) {
			var MAX_CHUNK = 1024;
			var curr;
			while (length > 0) {
				curr = String.fromCharCode.apply(String, HEAPU8.subarray(ptr, ptr + Math.min(length, MAX_CHUNK)));
				ret = ret ? ret + curr : curr;
				ptr += MAX_CHUNK;
				length -= MAX_CHUNK;
			}
			return ret;
		}
		return Module["UTF8ToString"](ptr);
	}
	Module["Pointer_stringify"] = Pointer_stringify;
	function AsciiToString(ptr) {
		var str = "";
		while (1) {
			var ch = HEAP8[ptr++ >> 0];
			if (!ch) return str;
			str += String.fromCharCode(ch);
		}
	}
	Module["AsciiToString"] = AsciiToString;
	function stringToAscii(str, outPtr) {
		return writeAsciiToMemory(str, outPtr, false);
	}
	Module["stringToAscii"] = stringToAscii;
	function UTF8ArrayToString(u8Array, idx) {
		var u0, u1, u2, u3, u4, u5;
		var str = "";
		while (1) {
			u0 = u8Array[idx++];
			if (!u0) return str;
			if (!(u0 & 128)) {
				str += String.fromCharCode(u0);
				continue;
			}
			u1 = u8Array[idx++] & 63;
			if ((u0 & 224) == 192) {
				str += String.fromCharCode((u0 & 31) << 6 | u1);
				continue;
			}
			u2 = u8Array[idx++] & 63;
			if ((u0 & 240) == 224) {
				u0 = (u0 & 15) << 12 | u1 << 6 | u2;
			} else {
				u3 = u8Array[idx++] & 63;
				if ((u0 & 248) == 240) {
					u0 = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | u3;
				} else {
					u4 = u8Array[idx++] & 63;
					if ((u0 & 252) == 248) {
						u0 = (u0 & 3) << 24 | u1 << 18 | u2 << 12 | u3 << 6 | u4;
					} else {
						u5 = u8Array[idx++] & 63;
						u0 = (u0 & 1) << 30 | u1 << 24 | u2 << 18 | u3 << 12 | u4 << 6 | u5;
					}
				}
			}
			if (u0 < 65536) {
				str += String.fromCharCode(u0);
			} else {
				var ch = u0 - 65536;
				str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
			}
		}
	}
	Module["UTF8ArrayToString"] = UTF8ArrayToString;
	function UTF8ToString(ptr) {
		return UTF8ArrayToString(HEAPU8, ptr);
	}
	Module["UTF8ToString"] = UTF8ToString;
	function stringToUTF8Array(str, outU8Array, outIdx, maxBytesToWrite) {
		if (!(maxBytesToWrite > 0)) return 0;
		var startIdx = outIdx;
		var endIdx = outIdx + maxBytesToWrite - 1;
		for (var i = 0; i < str.length; ++i) {
			var u = str.charCodeAt(i);
			if (u >= 55296 && u <= 57343) u = 65536 + ((u & 1023) << 10) | str.charCodeAt(++i) & 1023;
			if (u <= 127) {
				if (outIdx >= endIdx) break;
				outU8Array[outIdx++] = u;
			} else if (u <= 2047) {
				if (outIdx + 1 >= endIdx) break;
				outU8Array[outIdx++] = 192 | u >> 6;
				outU8Array[outIdx++] = 128 | u & 63;
			} else if (u <= 65535) {
				if (outIdx + 2 >= endIdx) break;
				outU8Array[outIdx++] = 224 | u >> 12;
				outU8Array[outIdx++] = 128 | u >> 6 & 63;
				outU8Array[outIdx++] = 128 | u & 63;
			} else if (u <= 2097151) {
				if (outIdx + 3 >= endIdx) break;
				outU8Array[outIdx++] = 240 | u >> 18;
				outU8Array[outIdx++] = 128 | u >> 12 & 63;
				outU8Array[outIdx++] = 128 | u >> 6 & 63;
				outU8Array[outIdx++] = 128 | u & 63;
			} else if (u <= 67108863) {
				if (outIdx + 4 >= endIdx) break;
				outU8Array[outIdx++] = 248 | u >> 24;
				outU8Array[outIdx++] = 128 | u >> 18 & 63;
				outU8Array[outIdx++] = 128 | u >> 12 & 63;
				outU8Array[outIdx++] = 128 | u >> 6 & 63;
				outU8Array[outIdx++] = 128 | u & 63;
			} else {
				if (outIdx + 5 >= endIdx) break;
				outU8Array[outIdx++] = 252 | u >> 30;
				outU8Array[outIdx++] = 128 | u >> 24 & 63;
				outU8Array[outIdx++] = 128 | u >> 18 & 63;
				outU8Array[outIdx++] = 128 | u >> 12 & 63;
				outU8Array[outIdx++] = 128 | u >> 6 & 63;
				outU8Array[outIdx++] = 128 | u & 63;
			}
		}
		outU8Array[outIdx] = 0;
		return outIdx - startIdx;
	}
	Module["stringToUTF8Array"] = stringToUTF8Array;
	function stringToUTF8(str, outPtr, maxBytesToWrite) {
		return stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
	}
	Module["stringToUTF8"] = stringToUTF8;
	function lengthBytesUTF8(str) {
		var len = 0;
		for (var i = 0; i < str.length; ++i) {
			var u = str.charCodeAt(i);
			if (u >= 55296 && u <= 57343) u = 65536 + ((u & 1023) << 10) | str.charCodeAt(++i) & 1023;
			if (u <= 127) {
				++len;
			} else if (u <= 2047) {
				len += 2;
			} else if (u <= 65535) {
				len += 3;
			} else if (u <= 2097151) {
				len += 4;
			} else if (u <= 67108863) {
				len += 5;
			} else {
				len += 6;
			}
		}
		return len;
	}
	Module["lengthBytesUTF8"] = lengthBytesUTF8;
	function UTF16ToString(ptr) {
		var i = 0;
		var str = "";
		while (1) {
			var codeUnit = HEAP16[ptr + i * 2 >> 1];
			if (codeUnit == 0) return str;
			++i;
			str += String.fromCharCode(codeUnit);
		}
	}
	Module["UTF16ToString"] = UTF16ToString;
	function stringToUTF16(str, outPtr, maxBytesToWrite) {
		if (maxBytesToWrite === undefined) {
			maxBytesToWrite = 2147483647;
		}
		if (maxBytesToWrite < 2) return 0;
		maxBytesToWrite -= 2;
		var startPtr = outPtr;
		var numCharsToWrite = maxBytesToWrite < str.length * 2 ? maxBytesToWrite / 2 : str.length;
		for (var i = 0; i < numCharsToWrite; ++i) {
			var codeUnit = str.charCodeAt(i);
			HEAP16[outPtr >> 1] = codeUnit;
			outPtr += 2;
		}
		HEAP16[outPtr >> 1] = 0;
		return outPtr - startPtr;
	}
	Module["stringToUTF16"] = stringToUTF16;
	function lengthBytesUTF16(str) {
		return str.length * 2;
	}
	Module["lengthBytesUTF16"] = lengthBytesUTF16;
	function UTF32ToString(ptr) {
		var i = 0;
		var str = "";
		while (1) {
			var utf32 = HEAP32[ptr + i * 4 >> 2];
			if (utf32 == 0) return str;
			++i;
			if (utf32 >= 65536) {
				var ch = utf32 - 65536;
				str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
			} else {
				str += String.fromCharCode(utf32);
			}
		}
	}
	Module["UTF32ToString"] = UTF32ToString;
	function stringToUTF32(str, outPtr, maxBytesToWrite) {
		if (maxBytesToWrite === undefined) {
			maxBytesToWrite = 2147483647;
		}
		if (maxBytesToWrite < 4) return 0;
		var startPtr = outPtr;
		var endPtr = startPtr + maxBytesToWrite - 4;
		for (var i = 0; i < str.length; ++i) {
			var codeUnit = str.charCodeAt(i);
			if (codeUnit >= 55296 && codeUnit <= 57343) {
				var trailSurrogate = str.charCodeAt(++i);
				codeUnit = 65536 + ((codeUnit & 1023) << 10) | trailSurrogate & 1023;
			}
			HEAP32[outPtr >> 2] = codeUnit;
			outPtr += 4;
			if (outPtr + 4 > endPtr) break;
		}
		HEAP32[outPtr >> 2] = 0;
		return outPtr - startPtr;
	}
	Module["stringToUTF32"] = stringToUTF32;
	function lengthBytesUTF32(str) {
		var len = 0;
		for (var i = 0; i < str.length; ++i) {
			var codeUnit = str.charCodeAt(i);
			if (codeUnit >= 55296 && codeUnit <= 57343)++i;
			len += 4;
		}
		return len;
	}
	Module["lengthBytesUTF32"] = lengthBytesUTF32;
	function demangle(func) {
		var hasLibcxxabi = !!Module["___cxa_demangle"];
		if (hasLibcxxabi) {
			try {
				var buf = _malloc(func.length);
				writeStringToMemory(func.substr(1), buf);
				var status = _malloc(4);
				var ret = Module["___cxa_demangle"](buf, 0, 0, status);
				if (getValue(status, "i32") === 0 && ret) {
					return Pointer_stringify(ret);
				}
			} catch (e) { } finally {
				if (buf) _free(buf);
				if (status) _free(status);
				if (ret) _free(ret);
			}
		}
		var i = 3;
		var basicTypes = {
			v: "void",
			b: "bool",
			c: "char",
			s: "short",
			i: "int",
			l: "long",
			f: "float",
			d: "double",
			w: "wchar_t",
			a: "signed char",
			h: "unsigned char",
			t: "unsigned short",
			j: "unsigned int",
			m: "unsigned long",
			x: "long long",
			y: "unsigned long long",
			z: "..."
		};
		var subs = [];
		var first = true;
		function dump(x) {
			if (x) Module.print(x);
			Module.print(func);
			var pre = "";
			for (var a = 0; a < i; a++) pre += " ";
			Module.print(pre + "^");
		}
		function parseNested() {
			i++;
			if (func[i] === "K") i++;
			var parts = [];
			while (func[i] !== "E") {
				if (func[i] === "S") {
					i++;
					var next = func.indexOf("_", i);
					var num = func.substring(i, next) || 0;
					parts.push(subs[num] || "?");
					i = next + 1;
					continue;
				}
				if (func[i] === "C") {
					parts.push(parts[parts.length - 1]);
					i += 2;
					continue;
				}
				var size = parseInt(func.substr(i));
				var pre = size.toString().length;
				if (!size || !pre) {
					i--;
					break;
				}
				var curr = func.substr(i + pre, size);
				parts.push(curr);
				subs.push(curr);
				i += pre + size;
			}
			i++;
			return parts;
		}
		function parse(rawList, limit, allowVoid) {
			limit = limit || Infinity;
			var ret = "", list = [];
			function flushList() {
				return "(" + list.join(", ") + ")";
			}
			var name;
			if (func[i] === "N") {
				name = parseNested().join("::");
				limit--;
				if (limit === 0) return rawList ? [name] : name;
			} else {
				if (func[i] === "K" || first && func[i] === "L") i++;
				var size = parseInt(func.substr(i));
				if (size) {
					var pre = size.toString().length;
					name = func.substr(i + pre, size);
					i += pre + size;
				}
			}
			first = false;
			if (func[i] === "I") {
				i++;
				var iList = parse(true);
				var iRet = parse(true, 1, true);
				ret += iRet[0] + " " + name + "<" + iList.join(", ") + ">";
			} else {
				ret = name;
			}
			paramLoop: while (i < func.length && limit-- > 0) {
				var c = func[i++];
				if (c in basicTypes) {
					list.push(basicTypes[c]);
				} else {
					switch (c) {
						case "P":
							list.push(parse(true, 1, true)[0] + "*");
							break;

						case "R":
							list.push(parse(true, 1, true)[0] + "&");
							break;

						case "L":
							{
								i++;
								var end = func.indexOf("E", i);
								var size = end - i;
								list.push(func.substr(i, size));
								i += size + 2;
								break;
							}
							;

						case "A":
							{
								var size = parseInt(func.substr(i));
								i += size.toString().length;
								if (func[i] !== "_") throw "?";
								i++;
								list.push(parse(true, 1, true)[0] + " [" + size + "]");
								break;
							}
							;

						case "E":
							break paramLoop;

						default:
							ret += "?" + c;
							break paramLoop;
					}
				}
			}
			if (!allowVoid && list.length === 1 && list[0] === "void") list = [];
			if (rawList) {
				if (ret) {
					list.push(ret + "?");
				}
				return list;
			} else {
				return ret + flushList();
			}
		}
		var parsed = func;
		try {
			if (func == "Object._main" || func == "_main") {
				return "main()";
			}
			if (typeof func === "number") func = Pointer_stringify(func);
			if (func[0] !== "_") return func;
			if (func[1] !== "_") return func;
			if (func[2] !== "Z") return func;
			switch (func[3]) {
				case "n":
					return "operator new()";

				case "d":
					return "operator delete()";
			}
			parsed = parse();
		} catch (e) {
			parsed += "?";
		}
		if (parsed.indexOf("?") >= 0 && !hasLibcxxabi) {
			Runtime.warnOnce("warning: a problem occurred in builtin C++ name demangling; build with  -s DEMANGLE_SUPPORT=1  to link in libcxxabi demangling");
		}
		return parsed;
	}
	function demangleAll(text) {
		return text.replace(/__Z[\w\d_]+/g, function (x) {
			var y = demangle(x);
			return x === y ? x : x + " [" + y + "]";
		});
	}
	function jsStackTrace() {
		var err = new Error();
		if (!err.stack) {
			try {
				throw new Error(0);
			} catch (e) {
				err = e;
			}
			if (!err.stack) {
				return "(no stack trace available)";
			}
		}
		return err.stack.toString();
	}
	function stackTrace() {
		return demangleAll(jsStackTrace());
	}
	Module["stackTrace"] = stackTrace;
	var PAGE_SIZE = 4096;
	function alignMemoryPage(x) {
		if (x % 4096 > 0) {
			x += 4096 - x % 4096;
		}
		return x;
	}
	var HEAP;
	var HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;
	var STATIC_BASE = 0, STATICTOP = 0, staticSealed = false;
	var STACK_BASE = 0, STACKTOP = 0, STACK_MAX = 0;
	var DYNAMIC_BASE = 0, DYNAMICTOP = 0;
	function enlargeMemory() {
		abort("Cannot enlarge memory arrays. Either (1) compile with -s TOTAL_MEMORY=X with X higher than the current value " + TOTAL_MEMORY + ", (2) compile with ALLOW_MEMORY_GROWTH which adjusts the size at runtime but prevents some optimizations, or (3) set Module.TOTAL_MEMORY before the program runs.");
	}
	var TOTAL_STACK = Module["TOTAL_STACK"] || 5242880;
	var TOTAL_MEMORY = Module["TOTAL_MEMORY"] || 16777216;
	var totalMemory = 64 * 1024;
	while (totalMemory < TOTAL_MEMORY || totalMemory < 2 * TOTAL_STACK) {
		if (totalMemory < 16 * 1024 * 1024) {
			totalMemory *= 2;
		} else {
			totalMemory += 16 * 1024 * 1024;
		}
	}
	if (totalMemory !== TOTAL_MEMORY) {
		Module.printErr("increasing TOTAL_MEMORY to " + totalMemory + " to be compliant with the asm.js spec (and given that TOTAL_STACK=" + TOTAL_STACK + ")");
		TOTAL_MEMORY = totalMemory;
	}
	assert(typeof Int32Array !== "undefined" && typeof Float64Array !== "undefined" && !!new Int32Array(1)["subarray"] && !!new Int32Array(1)["set"], "JS engine does not provide full typed array support");
	var buffer = new ArrayBuffer(TOTAL_MEMORY);
	HEAP8 = new Int8Array(buffer);
	HEAP16 = new Int16Array(buffer);
	HEAP32 = new Int32Array(buffer);
	HEAPU8 = new Uint8Array(buffer);
	HEAPU16 = new Uint16Array(buffer);
	HEAPU32 = new Uint32Array(buffer);
	HEAPF32 = new Float32Array(buffer);
	HEAPF64 = new Float64Array(buffer);
	HEAP32[0] = 255;
	assert(HEAPU8[0] === 255 && HEAPU8[3] === 0, "Typed arrays 2 must be run on a little-endian system");
	Module["HEAP"] = HEAP;
	Module["buffer"] = buffer;
	Module["HEAP8"] = HEAP8;
	Module["HEAP16"] = HEAP16;
	Module["HEAP32"] = HEAP32;
	Module["HEAPU8"] = HEAPU8;
	Module["HEAPU16"] = HEAPU16;
	Module["HEAPU32"] = HEAPU32;
	Module["HEAPF32"] = HEAPF32;
	Module["HEAPF64"] = HEAPF64;
	function callRuntimeCallbacks(callbacks) {
		while (callbacks.length > 0) {
			var callback = callbacks.shift();
			if (typeof callback == "function") {
				callback();
				continue;
			}
			var func = callback.func;
			if (typeof func === "number") {
				if (callback.arg === undefined) {
					Runtime.dynCall("v", func);
				} else {
					Runtime.dynCall("vi", func, [callback.arg]);
				}
			} else {
				func(callback.arg === undefined ? null : callback.arg);
			}
		}
	}
	var __ATPRERUN__ = [];
	var __ATINIT__ = [];
	var __ATMAIN__ = [];
	var __ATEXIT__ = [];
	var __ATPOSTRUN__ = [];
	var runtimeInitialized = false;
	var runtimeExited = false;
	function preRun() {
		if (Module["preRun"]) {
			if (typeof Module["preRun"] == "function") Module["preRun"] = [Module["preRun"]];
			while (Module["preRun"].length) {
				addOnPreRun(Module["preRun"].shift());
			}
		}
		callRuntimeCallbacks(__ATPRERUN__);
	}
	function ensureInitRuntime() {
		if (runtimeInitialized) return;
		runtimeInitialized = true;
		callRuntimeCallbacks(__ATINIT__);
	}
	function preMain() {
		callRuntimeCallbacks(__ATMAIN__);
	}
	function exitRuntime() {
		callRuntimeCallbacks(__ATEXIT__);
		runtimeExited = true;
	}
	function postRun() {
		if (Module["postRun"]) {
			if (typeof Module["postRun"] == "function") Module["postRun"] = [Module["postRun"]];
			while (Module["postRun"].length) {
				addOnPostRun(Module["postRun"].shift());
			}
		}
		callRuntimeCallbacks(__ATPOSTRUN__);
	}
	function addOnPreRun(cb) {
		__ATPRERUN__.unshift(cb);
	}
	Module["addOnPreRun"] = Module.addOnPreRun = addOnPreRun;
	function addOnInit(cb) {
		__ATINIT__.unshift(cb);
	}
	Module["addOnInit"] = Module.addOnInit = addOnInit;
	function addOnPreMain(cb) {
		__ATMAIN__.unshift(cb);
	}
	Module["addOnPreMain"] = Module.addOnPreMain = addOnPreMain;
	function addOnExit(cb) {
		__ATEXIT__.unshift(cb);
	}
	Module["addOnExit"] = Module.addOnExit = addOnExit;
	function addOnPostRun(cb) {
		__ATPOSTRUN__.unshift(cb);
	}
	Module["addOnPostRun"] = Module.addOnPostRun = addOnPostRun;
	function intArrayFromString(stringy, dontAddNull, length) {
		var len = length > 0 ? length : lengthBytesUTF8(stringy) + 1;
		var u8array = new Array(len);
		var numBytesWritten = stringToUTF8Array(stringy, u8array, 0, u8array.length);
		if (dontAddNull) u8array.length = numBytesWritten;
		return u8array;
	}
	Module["intArrayFromString"] = intArrayFromString;
	function intArrayToString(array) {
		var ret = [];
		for (var i = 0; i < array.length; i++) {
			var chr = array[i];
			if (chr > 255) {
				chr &= 255;
			}
			ret.push(String.fromCharCode(chr));
		}
		return ret.join("");
	}
	Module["intArrayToString"] = intArrayToString;
	function writeStringToMemory(string, buffer, dontAddNull) {
		var array = intArrayFromString(string, dontAddNull);
		var i = 0;
		while (i < array.length) {
			var chr = array[i];
			HEAP8[buffer + i >> 0] = chr;
			i = i + 1;
		}
	}
	Module["writeStringToMemory"] = writeStringToMemory;
	function writeArrayToMemory(array, buffer) {
		for (var i = 0; i < array.length; i++) {
			HEAP8[buffer++ >> 0] = array[i];
		}
	}
	Module["writeArrayToMemory"] = writeArrayToMemory;
	function writeAsciiToMemory(str, buffer, dontAddNull) {
		for (var i = 0; i < str.length; ++i) {
			HEAP8[buffer++ >> 0] = str.charCodeAt(i);
		}
		if (!dontAddNull) HEAP8[buffer >> 0] = 0;
	}
	Module["writeAsciiToMemory"] = writeAsciiToMemory;
	function unSign(value, bits, ignore) {
		if (value >= 0) {
			return value;
		}
		return bits <= 32 ? 2 * Math.abs(1 << bits - 1) + value : Math.pow(2, bits) + value;
	}
	function reSign(value, bits, ignore) {
		if (value <= 0) {
			return value;
		}
		var half = bits <= 32 ? Math.abs(1 << bits - 1) : Math.pow(2, bits - 1);
		if (value >= half && (bits <= 32 || value > half)) {
			value = -2 * half + value;
		}
		return value;
	}
	if (!Math["imul"] || Math["imul"](4294967295, 5) !== -5) Math["imul"] = function imul(a, b) {
		var ah = a >>> 16;
		var al = a & 65535;
		var bh = b >>> 16;
		var bl = b & 65535;
		return al * bl + (ah * bl + al * bh << 16) | 0;
	};
	Math.imul = Math["imul"];
	if (!Math["clz32"]) Math["clz32"] = function (x) {
		x = x >>> 0;
		for (var i = 0; i < 32; i++) {
			if (x & 1 << 31 - i) return i;
		}
		return 32;
	};
	Math.clz32 = Math["clz32"];
	var Math_abs = Math.abs;
	var Math_cos = Math.cos;
	var Math_sin = Math.sin;
	var Math_tan = Math.tan;
	var Math_acos = Math.acos;
	var Math_asin = Math.asin;
	var Math_atan = Math.atan;
	var Math_atan2 = Math.atan2;
	var Math_exp = Math.exp;
	var Math_log = Math.log;
	var Math_sqrt = Math.sqrt;
	var Math_ceil = Math.ceil;
	var Math_floor = Math.floor;
	var Math_pow = Math.pow;
	var Math_imul = Math.imul;
	var Math_fround = Math.fround;
	var Math_min = Math.min;
	var Math_clz32 = Math.clz32;
	var runDependencies = 0;
	var runDependencyWatcher = null;
	var dependenciesFulfilled = null;
	function addRunDependency(id) {
		runDependencies++;
		if (Module["monitorRunDependencies"]) {
			Module["monitorRunDependencies"](runDependencies);
		}
	}
	Module["addRunDependency"] = addRunDependency;
	function removeRunDependency(id) {
		runDependencies--;
		if (Module["monitorRunDependencies"]) {
			Module["monitorRunDependencies"](runDependencies);
		}
		if (runDependencies == 0) {
			if (runDependencyWatcher !== null) {
				clearInterval(runDependencyWatcher);
				runDependencyWatcher = null;
			}
			if (dependenciesFulfilled) {
				var callback = dependenciesFulfilled;
				dependenciesFulfilled = null;
				callback();
			}
		}
	}
	Module["removeRunDependency"] = removeRunDependency;
	Module["preloadedImages"] = {};
	Module["preloadedAudios"] = {};
	var memoryInitializer = null;
	var ASM_CONSTS = [];
	STATIC_BASE = 8;
	STATICTOP = STATIC_BASE + 6528;
	__ATINIT__.push({
		func: function () {
			__GLOBAL__sub_I_voronoi_cpp();
		}
	}, {
			func: function () {
				__GLOBAL__sub_I_bind_cpp();
			}
		});
	allocate([86, 101, 114, 116, 101, 120, 0, 0, 120, 0, 0, 0, 0, 0, 0, 0, 121, 0, 0, 0, 0, 0, 0, 0, 105, 115, 95, 100, 101, 103, 101, 110, 101, 114, 97, 116, 101, 0, 0, 0, 118, 101, 99, 116, 111, 114, 95, 86, 101, 114, 116, 101, 120, 0, 0, 0, 69, 100, 103, 101, 0, 0, 0, 0, 118, 101, 114, 116, 101, 120, 48, 95, 105, 110, 100, 101, 120, 0, 0, 0, 118, 101, 114, 116, 101, 120, 49, 95, 105, 110, 100, 101, 120, 0, 0, 0, 99, 101, 108, 108, 95, 105, 110, 100, 101, 120, 0, 0, 0, 0, 0, 0, 105, 115, 95, 112, 114, 105, 109, 97, 114, 121, 0, 0, 0, 0, 0, 0, 105, 115, 95, 108, 105, 110, 101, 97, 114, 0, 0, 0, 0, 0, 0, 0, 118, 101, 99, 116, 111, 114, 95, 69, 100, 103, 101, 0, 0, 0, 0, 0, 67, 101, 108, 108, 0, 0, 0, 0, 115, 111, 117, 114, 99, 101, 95, 105, 110, 100, 101, 120, 0, 0, 0, 0, 115, 111, 117, 114, 99, 101, 95, 99, 97, 116, 101, 103, 111, 114, 121, 0, 99, 111, 110, 116, 97, 105, 110, 115, 95, 112, 111, 105, 110, 116, 0, 0, 118, 101, 99, 116, 111, 114, 95, 67, 101, 108, 108, 0, 0, 0, 0, 0, 82, 101, 115, 117, 108, 116, 0, 0, 118, 101, 114, 116, 101, 120, 101, 115, 0, 0, 0, 0, 0, 0, 0, 0, 101, 100, 103, 101, 115, 0, 0, 0, 99, 101, 108, 108, 115, 0, 0, 0, 118, 111, 114, 111, 110, 111, 105, 95, 99, 111, 110, 115, 116, 114, 117, 99, 116, 111, 114, 0, 0, 0, 0, 0, 105, 110, 115, 101, 114, 116, 95, 112, 111, 105, 110, 116, 0, 0, 0, 0, 105, 110, 115, 101, 114, 116, 95, 115, 101, 103, 109, 101, 110, 116, 0, 0, 99, 111, 110, 115, 116, 114, 117, 99, 116, 0, 0, 0, 0, 0, 0, 0, 105, 105, 105, 0, 0, 0, 0, 0, 120, 1, 0, 0, 184, 1, 0, 0, 54, 82, 101, 115, 117, 108, 116, 0, 208, 19, 0, 0, 112, 1, 0, 0, 80, 49, 57, 118, 111, 114, 111, 110, 111, 105, 95, 99, 111, 110, 115, 116, 114, 117, 99, 116, 111, 114, 0, 0, 49, 57, 118, 111, 114, 111, 110, 111, 105, 95, 99, 111, 110, 115, 116, 114, 117, 99, 116, 111, 114, 0, 0, 0, 208, 19, 0, 0, 152, 1, 0, 0, 240, 21, 0, 0, 128, 1, 0, 0, 0, 0, 0, 0, 176, 1, 0, 0, 118, 105, 105, 105, 105, 105, 105, 0, 80, 20, 0, 0, 184, 1, 0, 0, 208, 20, 0, 0, 208, 20, 0, 0, 208, 20, 0, 0, 208, 20, 0, 0, 118, 105, 105, 105, 105, 0, 0, 0, 80, 20, 0, 0, 184, 1, 0, 0, 208, 20, 0, 0, 208, 20, 0, 0, 105, 105, 0, 0, 0, 0, 0, 0, 184, 1, 0, 0, 0, 0, 0, 0, 118, 105, 0, 0, 0, 0, 0, 0, 118, 0, 0, 0, 0, 0, 0, 0, 105, 105, 0, 0, 0, 0, 0, 0, 80, 75, 49, 57, 118, 111, 114, 111, 110, 111, 105, 95, 99, 111, 110, 115, 116, 114, 117, 99, 116, 111, 114, 0, 240, 21, 0, 0, 40, 2, 0, 0, 1, 0, 0, 0, 176, 1, 0, 0, 118, 105, 105, 105, 0, 0, 0, 0, 105, 105, 105, 0, 0, 0, 0, 0, 78, 83, 116, 51, 95, 95, 49, 54, 118, 101, 99, 116, 111, 114, 73, 52, 67, 101, 108, 108, 78, 83, 95, 57, 97, 108, 108, 111, 99, 97, 116, 111, 114, 73, 83, 49, 95, 69, 69, 69, 69, 0, 0, 0, 0, 0, 0, 0, 78, 83, 116, 51, 95, 95, 49, 49, 51, 95, 95, 118, 101, 99, 116, 111, 114, 95, 98, 97, 115, 101, 73, 52, 67, 101, 108, 108, 78, 83, 95, 57, 97, 108, 108, 111, 99, 97, 116, 111, 114, 73, 83, 49, 95, 69, 69, 69, 69, 0, 0, 0, 0, 0, 0, 0, 78, 83, 116, 51, 95, 95, 49, 50, 48, 95, 95, 118, 101, 99, 116, 111, 114, 95, 98, 97, 115, 101, 95, 99, 111, 109, 109, 111, 110, 73, 76, 98, 49, 69, 69, 69, 0, 0, 0, 0, 208, 19, 0, 0, 200, 2, 0, 0, 144, 21, 0, 0, 144, 2, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 240, 2, 0, 0, 0, 0, 0, 0, 144, 21, 0, 0, 96, 2, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 248, 2, 0, 0, 0, 0, 0, 0, 118, 105, 105, 105, 0, 0, 0, 0, 105, 105, 105, 0, 0, 0, 0, 0, 78, 83, 116, 51, 95, 95, 49, 54, 118, 101, 99, 116, 111, 114, 73, 52, 69, 100, 103, 101, 78, 83, 95, 57, 97, 108, 108, 111, 99, 97, 116, 111, 114, 73, 83, 49, 95, 69, 69, 69, 69, 0, 0, 0, 0, 0, 0, 0, 78, 83, 116, 51, 95, 95, 49, 49, 51, 95, 95, 118, 101, 99, 116, 111, 114, 95, 98, 97, 115, 101, 73, 52, 69, 100, 103, 101, 78, 83, 95, 57, 97, 108, 108, 111, 99, 97, 116, 111, 114, 73, 83, 49, 95, 69, 69, 69, 69, 0, 0, 0, 0, 0, 0, 0, 144, 21, 0, 0, 104, 3, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 240, 2, 0, 0, 0, 0, 0, 0, 144, 21, 0, 0, 56, 3, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 160, 3, 0, 0, 0, 0, 0, 0, 118, 105, 105, 105, 0, 0, 0, 0, 105, 105, 105, 0, 0, 0, 0, 0, 78, 83, 116, 51, 95, 95, 49, 54, 118, 101, 99, 116, 111, 114, 73, 54, 86, 101, 114, 116, 101, 120, 78, 83, 95, 57, 97, 108, 108, 111, 99, 97, 116, 111, 114, 73, 83, 49, 95, 69, 69, 69, 69, 0, 0, 0, 0, 0, 78, 83, 116, 51, 95, 95, 49, 49, 51, 95, 95, 118, 101, 99, 116, 111, 114, 95, 98, 97, 115, 101, 73, 54, 86, 101, 114, 116, 101, 120, 78, 83, 95, 57, 97, 108, 108, 111, 99, 97, 116, 111, 114, 73, 83, 49, 95, 69, 69, 69, 69, 0, 0, 0, 0, 0, 144, 21, 0, 0, 16, 4, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 240, 2, 0, 0, 0, 0, 0, 0, 144, 21, 0, 0, 224, 3, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 72, 4, 0, 0, 0, 0, 0, 0, 105, 105, 0, 0, 0, 0, 0, 0, 152, 4, 0, 0, 0, 0, 0, 0, 80, 54, 82, 101, 115, 117, 108, 116, 0, 0, 0, 0, 0, 0, 0, 0, 240, 21, 0, 0, 136, 4, 0, 0, 0, 0, 0, 0, 120, 1, 0, 0, 118, 105, 0, 0, 0, 0, 0, 0, 105, 105, 0, 0, 0, 0, 0, 0, 80, 75, 54, 82, 101, 115, 117, 108, 116, 0, 0, 0, 0, 0, 0, 0, 240, 21, 0, 0, 184, 4, 0, 0, 1, 0, 0, 0, 120, 1, 0, 0, 112, 117, 115, 104, 95, 98, 97, 99, 107, 0, 0, 0, 0, 0, 0, 0, 114, 101, 115, 105, 122, 101, 0, 0, 115, 105, 122, 101, 0, 0, 0, 0, 103, 101, 116, 0, 0, 0, 0, 0, 115, 101, 116, 0, 0, 0, 0, 0, 105, 105, 105, 105, 105, 0, 0, 0, 112, 20, 0, 0, 16, 3, 0, 0, 224, 20, 0, 0, 40, 5, 0, 0, 52, 67, 101, 108, 108, 0, 0, 0, 208, 19, 0, 0, 32, 5, 0, 0, 105, 105, 105, 105, 0, 0, 0, 0, 96, 5, 0, 0, 16, 3, 0, 0, 224, 20, 0, 0, 0, 0, 0, 0, 78, 49, 48, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 51, 118, 97, 108, 69, 0, 0, 0, 0, 0, 0, 208, 19, 0, 0, 72, 5, 0, 0, 105, 105, 105, 0, 0, 0, 0, 0, 224, 20, 0, 0, 168, 5, 0, 0, 80, 75, 78, 83, 116, 51, 95, 95, 49, 54, 118, 101, 99, 116, 111, 114, 73, 52, 67, 101, 108, 108, 78, 83, 95, 57, 97, 108, 108, 111, 99, 97, 116, 111, 114, 73, 83, 49, 95, 69, 69, 69, 69, 0, 0, 0, 0, 0, 240, 21, 0, 0, 120, 5, 0, 0, 1, 0, 0, 0, 16, 3, 0, 0, 118, 105, 105, 105, 105, 0, 0, 0, 80, 20, 0, 0, 0, 6, 0, 0, 224, 20, 0, 0, 40, 5, 0, 0, 80, 78, 83, 116, 51, 95, 95, 49, 54, 118, 101, 99, 116, 111, 114, 73, 52, 67, 101, 108, 108, 78, 83, 95, 57, 97, 108, 108, 111, 99, 97, 116, 111, 114, 73, 83, 49, 95, 69, 69, 69, 69, 0, 0, 0, 0, 0, 0, 240, 21, 0, 0, 208, 5, 0, 0, 0, 0, 0, 0, 16, 3, 0, 0, 118, 105, 105, 105, 0, 0, 0, 0, 80, 20, 0, 0, 0, 6, 0, 0, 40, 5, 0, 0, 0, 0, 0, 0, 105, 105, 0, 0, 0, 0, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 118, 105, 0, 0, 0, 0, 0, 0, 105, 105, 0, 0, 0, 0, 0, 0, 118, 105, 105, 105, 0, 0, 0, 0, 105, 105, 105, 0, 0, 0, 0, 0, 118, 105, 105, 105, 0, 0, 0, 0, 105, 105, 105, 0, 0, 0, 0, 0, 118, 105, 0, 0, 0, 0, 0, 0, 105, 105, 0, 0, 0, 0, 0, 0, 80, 75, 52, 67, 101, 108, 108, 0, 240, 21, 0, 0, 120, 6, 0, 0, 1, 0, 0, 0, 40, 5, 0, 0, 80, 52, 67, 101, 108, 108, 0, 0, 240, 21, 0, 0, 144, 6, 0, 0, 0, 0, 0, 0, 40, 5, 0, 0, 105, 105, 105, 105, 105, 0, 0, 0, 112, 20, 0, 0, 184, 3, 0, 0, 224, 20, 0, 0, 200, 6, 0, 0, 52, 69, 100, 103, 101, 0, 0, 0, 208, 19, 0, 0, 192, 6, 0, 0, 105, 105, 105, 105, 0, 0, 0, 0, 96, 5, 0, 0, 184, 3, 0, 0, 224, 20, 0, 0, 0, 0, 0, 0, 105, 105, 105, 0, 0, 0, 0, 0, 224, 20, 0, 0, 40, 7, 0, 0, 80, 75, 78, 83, 116, 51, 95, 95, 49, 54, 118, 101, 99, 116, 111, 114, 73, 52, 69, 100, 103, 101, 78, 83, 95, 57, 97, 108, 108, 111, 99, 97, 116, 111, 114, 73, 83, 49, 95, 69, 69, 69, 69, 0, 0, 0, 0, 0, 240, 21, 0, 0, 248, 6, 0, 0, 1, 0, 0, 0, 184, 3, 0, 0, 118, 105, 105, 105, 105, 0, 0, 0, 80, 20, 0, 0, 128, 7, 0, 0, 224, 20, 0, 0, 200, 6, 0, 0, 80, 78, 83, 116, 51, 95, 95, 49, 54, 118, 101, 99, 116, 111, 114, 73, 52, 69, 100, 103, 101, 78, 83, 95, 57, 97, 108, 108, 111, 99, 97, 116, 111, 114, 73, 83, 49, 95, 69, 69, 69, 69, 0, 0, 0, 0, 0, 0, 240, 21, 0, 0, 80, 7, 0, 0, 0, 0, 0, 0, 184, 3, 0, 0, 118, 105, 105, 105, 0, 0, 0, 0, 80, 20, 0, 0, 128, 7, 0, 0, 200, 6, 0, 0, 0, 0, 0, 0, 105, 105, 0, 0, 0, 0, 0, 0, 128, 7, 0, 0, 0, 0, 0, 0, 118, 105, 0, 0, 0, 0, 0, 0, 105, 105, 0, 0, 0, 0, 0, 0, 118, 105, 105, 105, 0, 0, 0, 0, 105, 105, 105, 0, 0, 0, 0, 0, 118, 105, 105, 105, 0, 0, 0, 0, 105, 105, 105, 0, 0, 0, 0, 0, 118, 105, 0, 0, 0, 0, 0, 0, 105, 105, 0, 0, 0, 0, 0, 0, 80, 75, 52, 69, 100, 103, 101, 0, 240, 21, 0, 0, 248, 7, 0, 0, 1, 0, 0, 0, 200, 6, 0, 0, 80, 52, 69, 100, 103, 101, 0, 0, 240, 21, 0, 0, 16, 8, 0, 0, 0, 0, 0, 0, 200, 6, 0, 0, 105, 105, 105, 105, 105, 0, 0, 0, 112, 20, 0, 0, 96, 4, 0, 0, 224, 20, 0, 0, 72, 8, 0, 0, 54, 86, 101, 114, 116, 101, 120, 0, 208, 19, 0, 0, 64, 8, 0, 0, 105, 105, 105, 105, 0, 0, 0, 0, 96, 5, 0, 0, 96, 4, 0, 0, 224, 20, 0, 0, 0, 0, 0, 0, 105, 105, 105, 0, 0, 0, 0, 0, 224, 20, 0, 0, 168, 8, 0, 0, 80, 75, 78, 83, 116, 51, 95, 95, 49, 54, 118, 101, 99, 116, 111, 114, 73, 54, 86, 101, 114, 116, 101, 120, 78, 83, 95, 57, 97, 108, 108, 111, 99, 97, 116, 111, 114, 73, 83, 49, 95, 69, 69, 69, 69, 0, 0, 0, 240, 21, 0, 0, 120, 8, 0, 0, 1, 0, 0, 0, 96, 4, 0, 0, 118, 105, 105, 105, 105, 0, 0, 0, 80, 20, 0, 0, 0, 9, 0, 0, 224, 20, 0, 0, 72, 8, 0, 0, 80, 78, 83, 116, 51, 95, 95, 49, 54, 118, 101, 99, 116, 111, 114, 73, 54, 86, 101, 114, 116, 101, 120, 78, 83, 95, 57, 97, 108, 108, 111, 99, 97, 116, 111, 114, 73, 83, 49, 95, 69, 69, 69, 69, 0, 0, 0, 0, 240, 21, 0, 0, 208, 8, 0, 0, 0, 0, 0, 0, 96, 4, 0, 0, 118, 105, 105, 105, 0, 0, 0, 0, 80, 20, 0, 0, 0, 9, 0, 0, 72, 8, 0, 0, 0, 0, 0, 0, 105, 105, 0, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 118, 105, 0, 0, 0, 0, 0, 0, 105, 105, 0, 0, 0, 0, 0, 0, 118, 105, 105, 105, 0, 0, 0, 0, 105, 105, 105, 0, 0, 0, 0, 0, 118, 105, 105, 100, 0, 0, 0, 0, 100, 105, 105, 0, 0, 0, 0, 0, 118, 105, 0, 0, 0, 0, 0, 0, 105, 105, 0, 0, 0, 0, 0, 0, 80, 75, 54, 86, 101, 114, 116, 101, 120, 0, 0, 0, 0, 0, 0, 0, 240, 21, 0, 0, 120, 9, 0, 0, 1, 0, 0, 0, 72, 8, 0, 0, 80, 54, 86, 101, 114, 116, 101, 120, 0, 0, 0, 0, 0, 0, 0, 0, 240, 21, 0, 0, 152, 9, 0, 0, 0, 0, 0, 0, 72, 8, 0, 0, 118, 111, 105, 100, 0, 0, 0, 0, 98, 111, 111, 108, 0, 0, 0, 0, 99, 104, 97, 114, 0, 0, 0, 0, 115, 105, 103, 110, 101, 100, 32, 99, 104, 97, 114, 0, 0, 0, 0, 0, 117, 110, 115, 105, 103, 110, 101, 100, 32, 99, 104, 97, 114, 0, 0, 0, 115, 104, 111, 114, 116, 0, 0, 0, 117, 110, 115, 105, 103, 110, 101, 100, 32, 115, 104, 111, 114, 116, 0, 0, 105, 110, 116, 0, 0, 0, 0, 0, 117, 110, 115, 105, 103, 110, 101, 100, 32, 105, 110, 116, 0, 0, 0, 0, 108, 111, 110, 103, 0, 0, 0, 0, 117, 110, 115, 105, 103, 110, 101, 100, 32, 108, 111, 110, 103, 0, 0, 0, 102, 108, 111, 97, 116, 0, 0, 0, 100, 111, 117, 98, 108, 101, 0, 0, 115, 116, 100, 58, 58, 115, 116, 114, 105, 110, 103, 0, 0, 0, 0, 0, 115, 116, 100, 58, 58, 98, 97, 115, 105, 99, 95, 115, 116, 114, 105, 110, 103, 60, 117, 110, 115, 105, 103, 110, 101, 100, 32, 99, 104, 97, 114, 62, 0, 0, 0, 0, 0, 0, 0, 0, 115, 116, 100, 58, 58, 119, 115, 116, 114, 105, 110, 103, 0, 0, 0, 0, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 58, 58, 118, 97, 108, 0, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 58, 58, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 60, 99, 104, 97, 114, 62, 0, 0, 0, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 58, 58, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 60, 115, 105, 103, 110, 101, 100, 32, 99, 104, 97, 114, 62, 0, 0, 0, 0, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 58, 58, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 60, 117, 110, 115, 105, 103, 110, 101, 100, 32, 99, 104, 97, 114, 62, 0, 0, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 58, 58, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 60, 115, 104, 111, 114, 116, 62, 0, 0, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 58, 58, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 60, 117, 110, 115, 105, 103, 110, 101, 100, 32, 115, 104, 111, 114, 116, 62, 0, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 58, 58, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 60, 105, 110, 116, 62, 0, 0, 0, 0, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 58, 58, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 60, 117, 110, 115, 105, 103, 110, 101, 100, 32, 105, 110, 116, 62, 0, 0, 0, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 58, 58, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 60, 108, 111, 110, 103, 62, 0, 0, 0, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 58, 58, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 60, 117, 110, 115, 105, 103, 110, 101, 100, 32, 108, 111, 110, 103, 62, 0, 0, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 58, 58, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 60, 105, 110, 116, 56, 95, 116, 62, 0, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 58, 58, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 60, 117, 105, 110, 116, 56, 95, 116, 62, 0, 0, 0, 0, 0, 0, 0, 0, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 58, 58, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 60, 105, 110, 116, 49, 54, 95, 116, 62, 0, 0, 0, 0, 0, 0, 0, 0, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 58, 58, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 60, 117, 105, 110, 116, 49, 54, 95, 116, 62, 0, 0, 0, 0, 0, 0, 0, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 58, 58, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 60, 105, 110, 116, 51, 50, 95, 116, 62, 0, 0, 0, 0, 0, 0, 0, 0, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 58, 58, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 60, 117, 105, 110, 116, 51, 50, 95, 116, 62, 0, 0, 0, 0, 0, 0, 0, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 58, 58, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 60, 102, 108, 111, 97, 116, 62, 0, 0, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 58, 58, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 60, 100, 111, 117, 98, 108, 101, 62, 0, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 58, 58, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 60, 108, 111, 110, 103, 32, 100, 111, 117, 98, 108, 101, 62, 0, 0, 0, 0, 78, 49, 48, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 49, 49, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 73, 101, 69, 69, 0, 0, 208, 19, 0, 0, 56, 13, 0, 0, 78, 49, 48, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 49, 49, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 73, 100, 69, 69, 0, 0, 208, 19, 0, 0, 96, 13, 0, 0, 78, 49, 48, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 49, 49, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 73, 102, 69, 69, 0, 0, 208, 19, 0, 0, 136, 13, 0, 0, 78, 49, 48, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 49, 49, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 73, 109, 69, 69, 0, 0, 208, 19, 0, 0, 176, 13, 0, 0, 78, 49, 48, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 49, 49, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 73, 108, 69, 69, 0, 0, 208, 19, 0, 0, 216, 13, 0, 0, 78, 49, 48, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 49, 49, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 73, 106, 69, 69, 0, 0, 208, 19, 0, 0, 0, 14, 0, 0, 78, 49, 48, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 49, 49, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 73, 105, 69, 69, 0, 0, 208, 19, 0, 0, 40, 14, 0, 0, 78, 49, 48, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 49, 49, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 73, 116, 69, 69, 0, 0, 208, 19, 0, 0, 80, 14, 0, 0, 78, 49, 48, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 49, 49, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 73, 115, 69, 69, 0, 0, 208, 19, 0, 0, 120, 14, 0, 0, 78, 49, 48, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 49, 49, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 73, 104, 69, 69, 0, 0, 208, 19, 0, 0, 160, 14, 0, 0, 78, 49, 48, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 49, 49, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 73, 97, 69, 69, 0, 0, 208, 19, 0, 0, 200, 14, 0, 0, 78, 49, 48, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 49, 49, 109, 101, 109, 111, 114, 121, 95, 118, 105, 101, 119, 73, 99, 69, 69, 0, 0, 208, 19, 0, 0, 240, 14, 0, 0, 78, 83, 116, 51, 95, 95, 49, 49, 50, 98, 97, 115, 105, 99, 95, 115, 116, 114, 105, 110, 103, 73, 119, 78, 83, 95, 49, 49, 99, 104, 97, 114, 95, 116, 114, 97, 105, 116, 115, 73, 119, 69, 69, 78, 83, 95, 57, 97, 108, 108, 111, 99, 97, 116, 111, 114, 73, 119, 69, 69, 69, 69, 0, 0, 78, 83, 116, 51, 95, 95, 49, 50, 49, 95, 95, 98, 97, 115, 105, 99, 95, 115, 116, 114, 105, 110, 103, 95, 99, 111, 109, 109, 111, 110, 73, 76, 98, 49, 69, 69, 69, 0, 0, 0, 208, 19, 0, 0, 88, 15, 0, 0, 144, 21, 0, 0, 24, 15, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 128, 15, 0, 0, 0, 0, 0, 0, 78, 83, 116, 51, 95, 95, 49, 49, 50, 98, 97, 115, 105, 99, 95, 115, 116, 114, 105, 110, 103, 73, 104, 78, 83, 95, 49, 49, 99, 104, 97, 114, 95, 116, 114, 97, 105, 116, 115, 73, 104, 69, 69, 78, 83, 95, 57, 97, 108, 108, 111, 99, 97, 116, 111, 114, 73, 104, 69, 69, 69, 69, 0, 0, 144, 21, 0, 0, 160, 15, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 128, 15, 0, 0, 0, 0, 0, 0, 78, 83, 116, 51, 95, 95, 49, 49, 50, 98, 97, 115, 105, 99, 95, 115, 116, 114, 105, 110, 103, 73, 99, 78, 83, 95, 49, 49, 99, 104, 97, 114, 95, 116, 114, 97, 105, 116, 115, 73, 99, 69, 69, 78, 83, 95, 57, 97, 108, 108, 111, 99, 97, 116, 111, 114, 73, 99, 69, 69, 69, 69, 0, 0, 144, 21, 0, 0, 248, 15, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 128, 15, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 96, 16, 0, 0, 0, 0, 0, 0, 117, 110, 99, 97, 117, 103, 104, 116, 0, 0, 0, 0, 0, 0, 0, 0, 116, 101, 114, 109, 105, 110, 97, 116, 105, 110, 103, 32, 119, 105, 116, 104, 32, 37, 115, 32, 101, 120, 99, 101, 112, 116, 105, 111, 110, 32, 111, 102, 32, 116, 121, 112, 101, 32, 37, 115, 58, 32, 37, 115, 0, 0, 0, 0, 116, 101, 114, 109, 105, 110, 97, 116, 105, 110, 103, 32, 119, 105, 116, 104, 32, 37, 115, 32, 101, 120, 99, 101, 112, 116, 105, 111, 110, 32, 111, 102, 32, 116, 121, 112, 101, 32, 37, 115, 0, 0, 0, 0, 0, 0, 0, 0, 116, 101, 114, 109, 105, 110, 97, 116, 105, 110, 103, 32, 119, 105, 116, 104, 32, 37, 115, 32, 102, 111, 114, 101, 105, 103, 110, 32, 101, 120, 99, 101, 112, 116, 105, 111, 110, 0, 0, 0, 116, 101, 114, 109, 105, 110, 97, 116, 105, 110, 103, 0, 0, 0, 0, 0, 95, 95, 116, 104, 114, 111, 119, 95, 108, 101, 110, 103, 116, 104, 95, 101, 114, 114, 111, 114, 0, 0, 0, 0, 33, 34, 118, 101, 99, 116, 111, 114, 32, 108, 101, 110, 103, 116, 104, 95, 101, 114, 114, 111, 114, 34, 0, 0, 47, 104, 111, 109, 101, 47, 101, 109, 115, 100, 107, 47, 120, 47, 101, 109, 115, 100, 107, 95, 112, 111, 114, 116, 97, 98, 108, 101, 47, 101, 109, 115, 99, 114, 105, 112, 116, 101, 110, 47, 109, 97, 115, 116, 101, 114, 47, 115, 121, 115, 116, 101, 109, 47, 105, 110, 99, 108, 117, 100, 101, 47, 108, 105, 98, 99, 120, 120, 47, 118, 101, 99, 116, 111, 114, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 112, 116, 104, 114, 101, 97, 100, 95, 111, 110, 99, 101, 32, 102, 97, 105, 108, 117, 114, 101, 32, 105, 110, 32, 95, 95, 99, 120, 97, 95, 103, 101, 116, 95, 103, 108, 111, 98, 97, 108, 115, 95, 102, 97, 115, 116, 40, 41, 0, 0, 0, 0, 0, 0, 0, 0, 99, 97, 110, 110, 111, 116, 32, 99, 114, 101, 97, 116, 101, 32, 112, 116, 104, 114, 101, 97, 100, 32, 107, 101, 121, 32, 102, 111, 114, 32, 95, 95, 99, 120, 97, 95, 103, 101, 116, 95, 103, 108, 111, 98, 97, 108, 115, 40, 41, 0, 0, 0, 0, 0, 0, 0, 99, 97, 110, 110, 111, 116, 32, 122, 101, 114, 111, 32, 111, 117, 116, 32, 116, 104, 114, 101, 97, 100, 32, 118, 97, 108, 117, 101, 32, 102, 111, 114, 32, 95, 95, 99, 120, 97, 95, 103, 101, 116, 95, 103, 108, 111, 98, 97, 108, 115, 40, 41, 0, 0, 0, 0, 0, 0, 0, 0, 120, 18, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 115, 116, 100, 58, 58, 98, 97, 100, 95, 97, 108, 108, 111, 99, 0, 0, 83, 116, 57, 98, 97, 100, 95, 97, 108, 108, 111, 99, 0, 0, 0, 0, 48, 21, 0, 0, 104, 18, 0, 0, 200, 18, 0, 0, 0, 0, 0, 0, 116, 101, 114, 109, 105, 110, 97, 116, 101, 95, 104, 97, 110, 100, 108, 101, 114, 32, 117, 110, 101, 120, 112, 101, 99, 116, 101, 100, 108, 121, 32, 114, 101, 116, 117, 114, 110, 101, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 83, 116, 57, 101, 120, 99, 101, 112, 116, 105, 111, 110, 0, 0, 0, 0, 208, 19, 0, 0, 184, 18, 0, 0, 83, 116, 57, 116, 121, 112, 101, 95, 105, 110, 102, 111, 0, 0, 0, 0, 208, 19, 0, 0, 208, 18, 0, 0, 78, 49, 48, 95, 95, 99, 120, 120, 97, 98, 105, 118, 49, 49, 54, 95, 95, 115, 104, 105, 109, 95, 116, 121, 112, 101, 95, 105, 110, 102, 111, 69, 0, 0, 0, 0, 0, 0, 0, 0, 48, 21, 0, 0, 232, 18, 0, 0, 224, 18, 0, 0, 0, 0, 0, 0, 78, 49, 48, 95, 95, 99, 120, 120, 97, 98, 105, 118, 49, 49, 55, 95, 95, 99, 108, 97, 115, 115, 95, 116, 121, 112, 101, 95, 105, 110, 102, 111, 69, 0, 0, 0, 0, 0, 0, 0, 48, 21, 0, 0, 32, 19, 0, 0, 16, 19, 0, 0, 0, 0, 0, 0, 78, 49, 48, 95, 95, 99, 120, 120, 97, 98, 105, 118, 49, 49, 57, 95, 95, 112, 111, 105, 110, 116, 101, 114, 95, 116, 121, 112, 101, 95, 105, 110, 102, 111, 69, 0, 0, 0, 0, 0, 78, 49, 48, 95, 95, 99, 120, 120, 97, 98, 105, 118, 49, 49, 55, 95, 95, 112, 98, 97, 115, 101, 95, 116, 121, 112, 101, 95, 105, 110, 102, 111, 69, 0, 0, 0, 0, 0, 0, 0, 48, 21, 0, 0, 128, 19, 0, 0, 16, 19, 0, 0, 0, 0, 0, 0, 48, 21, 0, 0, 88, 19, 0, 0, 168, 19, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 72, 19, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0, 5, 0, 0, 0, 6, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 56, 20, 0, 0, 3, 0, 0, 0, 7, 0, 0, 0, 5, 0, 0, 0, 6, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 78, 49, 48, 95, 95, 99, 120, 120, 97, 98, 105, 118, 49, 50, 51, 95, 95, 102, 117, 110, 100, 97, 109, 101, 110, 116, 97, 108, 95, 116, 121, 112, 101, 95, 105, 110, 102, 111, 69, 0, 48, 21, 0, 0, 16, 20, 0, 0, 16, 19, 0, 0, 0, 0, 0, 0, 118, 0, 0, 0, 0, 0, 0, 0, 248, 19, 0, 0, 72, 20, 0, 0, 68, 110, 0, 0, 0, 0, 0, 0, 248, 19, 0, 0, 88, 20, 0, 0, 98, 0, 0, 0, 0, 0, 0, 0, 248, 19, 0, 0, 104, 20, 0, 0, 99, 0, 0, 0, 0, 0, 0, 0, 248, 19, 0, 0, 120, 20, 0, 0, 104, 0, 0, 0, 0, 0, 0, 0, 248, 19, 0, 0, 136, 20, 0, 0, 97, 0, 0, 0, 0, 0, 0, 0, 248, 19, 0, 0, 152, 20, 0, 0, 115, 0, 0, 0, 0, 0, 0, 0, 248, 19, 0, 0, 168, 20, 0, 0, 116, 0, 0, 0, 0, 0, 0, 0, 248, 19, 0, 0, 184, 20, 0, 0, 105, 0, 0, 0, 0, 0, 0, 0, 248, 19, 0, 0, 200, 20, 0, 0, 106, 0, 0, 0, 0, 0, 0, 0, 248, 19, 0, 0, 216, 20, 0, 0, 108, 0, 0, 0, 0, 0, 0, 0, 248, 19, 0, 0, 232, 20, 0, 0, 109, 0, 0, 0, 0, 0, 0, 0, 248, 19, 0, 0, 248, 20, 0, 0, 102, 0, 0, 0, 0, 0, 0, 0, 248, 19, 0, 0, 8, 21, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 248, 19, 0, 0, 24, 21, 0, 0, 0, 0, 0, 0, 120, 21, 0, 0, 3, 0, 0, 0, 8, 0, 0, 0, 5, 0, 0, 0, 6, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 78, 49, 48, 95, 95, 99, 120, 120, 97, 98, 105, 118, 49, 50, 48, 95, 95, 115, 105, 95, 99, 108, 97, 115, 115, 95, 116, 121, 112, 101, 95, 105, 110, 102, 111, 69, 0, 0, 0, 0, 48, 21, 0, 0, 80, 21, 0, 0, 72, 19, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 216, 21, 0, 0, 3, 0, 0, 0, 9, 0, 0, 0, 5, 0, 0, 0, 6, 0, 0, 0, 1, 0, 0, 0, 3, 0, 0, 0, 3, 0, 0, 0, 3, 0, 0, 0, 78, 49, 48, 95, 95, 99, 120, 120, 97, 98, 105, 118, 49, 50, 49, 95, 95, 118, 109, 105, 95, 99, 108, 97, 115, 115, 95, 116, 121, 112, 101, 95, 105, 110, 102, 111, 69, 0, 0, 0, 48, 21, 0, 0, 176, 21, 0, 0, 72, 19, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 184, 19, 0, 0, 3, 0, 0, 0, 10, 0, 0, 0, 5, 0, 0, 0, 6, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 5, 0, 0, 0, 7, 0, 0, 0, 11, 0, 0, 0, 13, 0, 0, 0, 17, 0, 0, 0, 19, 0, 0, 0, 23, 0, 0, 0, 29, 0, 0, 0, 31, 0, 0, 0, 37, 0, 0, 0, 41, 0, 0, 0, 43, 0, 0, 0, 47, 0, 0, 0, 53, 0, 0, 0, 59, 0, 0, 0, 61, 0, 0, 0, 67, 0, 0, 0, 71, 0, 0, 0, 73, 0, 0, 0, 79, 0, 0, 0, 83, 0, 0, 0, 89, 0, 0, 0, 97, 0, 0, 0, 101, 0, 0, 0, 103, 0, 0, 0, 107, 0, 0, 0, 109, 0, 0, 0, 113, 0, 0, 0, 127, 0, 0, 0, 131, 0, 0, 0, 137, 0, 0, 0, 139, 0, 0, 0, 149, 0, 0, 0, 151, 0, 0, 0, 157, 0, 0, 0, 163, 0, 0, 0, 167, 0, 0, 0, 173, 0, 0, 0, 179, 0, 0, 0, 181, 0, 0, 0, 191, 0, 0, 0, 193, 0, 0, 0, 197, 0, 0, 0, 199, 0, 0, 0, 211, 0, 0, 0, 1, 0, 0, 0, 11, 0, 0, 0, 13, 0, 0, 0, 17, 0, 0, 0, 19, 0, 0, 0, 23, 0, 0, 0, 29, 0, 0, 0, 31, 0, 0, 0, 37, 0, 0, 0, 41, 0, 0, 0, 43, 0, 0, 0, 47, 0, 0, 0, 53, 0, 0, 0, 59, 0, 0, 0, 61, 0, 0, 0, 67, 0, 0, 0, 71, 0, 0, 0, 73, 0, 0, 0, 79, 0, 0, 0, 83, 0, 0, 0, 89, 0, 0, 0, 97, 0, 0, 0, 101, 0, 0, 0, 103, 0, 0, 0, 107, 0, 0, 0, 109, 0, 0, 0, 113, 0, 0, 0, 121, 0, 0, 0, 127, 0, 0, 0, 131, 0, 0, 0, 137, 0, 0, 0, 139, 0, 0, 0, 143, 0, 0, 0, 149, 0, 0, 0, 151, 0, 0, 0, 157, 0, 0, 0, 163, 0, 0, 0, 167, 0, 0, 0, 169, 0, 0, 0, 173, 0, 0, 0, 179, 0, 0, 0, 181, 0, 0, 0, 187, 0, 0, 0, 191, 0, 0, 0, 193, 0, 0, 0, 197, 0, 0, 0, 199, 0, 0, 0, 209, 0, 0, 0], "i8", ALLOC_NONE, Runtime.GLOBAL_BASE);
	var tempDoublePtr = Runtime.alignMemory(allocate(12, "i8", ALLOC_STATIC), 8);
	assert(tempDoublePtr % 8 == 0);
	function copyTempFloat(ptr) {
		HEAP8[tempDoublePtr] = HEAP8[ptr];
		HEAP8[tempDoublePtr + 1] = HEAP8[ptr + 1];
		HEAP8[tempDoublePtr + 2] = HEAP8[ptr + 2];
		HEAP8[tempDoublePtr + 3] = HEAP8[ptr + 3];
	}
	function copyTempDouble(ptr) {
		HEAP8[tempDoublePtr] = HEAP8[ptr];
		HEAP8[tempDoublePtr + 1] = HEAP8[ptr + 1];
		HEAP8[tempDoublePtr + 2] = HEAP8[ptr + 2];
		HEAP8[tempDoublePtr + 3] = HEAP8[ptr + 3];
		HEAP8[tempDoublePtr + 4] = HEAP8[ptr + 4];
		HEAP8[tempDoublePtr + 5] = HEAP8[ptr + 5];
		HEAP8[tempDoublePtr + 6] = HEAP8[ptr + 6];
		HEAP8[tempDoublePtr + 7] = HEAP8[ptr + 7];
	}
	Module["_i64Subtract"] = _i64Subtract;
	function ___assert_fail(condition, filename, line, func) {
		ABORT = true;
		throw "Assertion failed: " + Pointer_stringify(condition) + ", at: " + [filename ? Pointer_stringify(filename) : "unknown filename", line, func ? Pointer_stringify(func) : "unknown function"] + " at " + stackTrace();
	}
	function embind_init_charCodes() {
		var codes = new Array(256);
		for (var i = 0; i < 256; ++i) {
			codes[i] = String.fromCharCode(i);
		}
		embind_charCodes = codes;
	}
	var embind_charCodes = undefined;
	function readLatin1String(ptr) {
		var ret = "";
		var c = ptr;
		while (HEAPU8[c]) {
			ret += embind_charCodes[HEAPU8[c++]];
		}
		return ret;
	}
	var awaitingDependencies = {};
	var registeredTypes = {};
	var typeDependencies = {};
	var char_0 = 48;
	var char_9 = 57;
	function makeLegalFunctionName(name) {
		if (undefined === name) {
			return "_unknown";
		}
		name = name.replace(/[^a-zA-Z0-9_]/g, "$");
		var f = name.charCodeAt(0);
		if (f >= char_0 && f <= char_9) {
			return "_" + name;
		} else {
			return name;
		}
	}
	function createNamedFunction(name, body) {
		name = makeLegalFunctionName(name);
		return new Function("body", "return function " + name + "() {\n" + '    "use strict";' + "    return body.apply(this, arguments);\n" + "};\n")(body);
	}
	function extendError(baseErrorType, errorName) {
		var errorClass = createNamedFunction(errorName, function (message) {
			this.name = errorName;
			this.message = message;
			var stack = new Error(message).stack;
			if (stack !== undefined) {
				this.stack = this.toString() + "\n" + stack.replace(/^Error(:[^\n]*)?\n/, "");
			}
		});
		errorClass.prototype = Object.create(baseErrorType.prototype);
		errorClass.prototype.constructor = errorClass;
		errorClass.prototype.toString = function () {
			if (this.message === undefined) {
				return this.name;
			} else {
				return this.name + ": " + this.message;
			}
		};
		return errorClass;
	}
	var BindingError = undefined;
	function throwBindingError(message) {
		throw new BindingError(message);
	}
	var InternalError = undefined;
	function throwInternalError(message) {
		throw new InternalError(message);
	}
	function whenDependentTypesAreResolved(myTypes, dependentTypes, getTypeConverters) {
		myTypes.forEach(function (type) {
			typeDependencies[type] = dependentTypes;
		});
		function onComplete(typeConverters) {
			var myTypeConverters = getTypeConverters(typeConverters);
			if (myTypeConverters.length !== myTypes.length) {
				throwInternalError("Mismatched type converter count");
			}
			for (var i = 0; i < myTypes.length; ++i) {
				registerType(myTypes[i], myTypeConverters[i]);
			}
		}
		var typeConverters = new Array(dependentTypes.length);
		var unregisteredTypes = [];
		var registered = 0;
		dependentTypes.forEach(function (dt, i) {
			if (registeredTypes.hasOwnProperty(dt)) {
				typeConverters[i] = registeredTypes[dt];
			} else {
				unregisteredTypes.push(dt);
				if (!awaitingDependencies.hasOwnProperty(dt)) {
					awaitingDependencies[dt] = [];
				}
				awaitingDependencies[dt].push(function () {
					typeConverters[i] = registeredTypes[dt];
					++registered;
					if (registered === unregisteredTypes.length) {
						onComplete(typeConverters);
					}
				});
			}
		});
		if (0 === unregisteredTypes.length) {
			onComplete(typeConverters);
		}
	}
	function registerType(rawType, registeredInstance, options) {
		options = options || {};
		if (!("argPackAdvance" in registeredInstance)) {
			throw new TypeError("registerType registeredInstance requires argPackAdvance");
		}
		var name = registeredInstance.name;
		if (!rawType) {
			throwBindingError('type "' + name + '" must have a positive integer typeid pointer');
		}
		if (registeredTypes.hasOwnProperty(rawType)) {
			if (options.ignoreDuplicateRegistrations) {
				return;
			} else {
				throwBindingError("Cannot register type '" + name + "' twice");
			}
		}
		registeredTypes[rawType] = registeredInstance;
		delete typeDependencies[rawType];
		if (awaitingDependencies.hasOwnProperty(rawType)) {
			var callbacks = awaitingDependencies[rawType];
			delete awaitingDependencies[rawType];
			callbacks.forEach(function (cb) {
				cb();
			});
		}
	}
	function __embind_register_void(rawType, name) {
		name = readLatin1String(name);
		registerType(rawType, {
			isVoid: true,
			name: name,
			argPackAdvance: 0,
			fromWireType: function () {
				return undefined;
			},
			toWireType: function (destructors, o) {
				return undefined;
			}
		});
	}
	function __ZSt18uncaught_exceptionv() {
		return !!__ZSt18uncaught_exceptionv.uncaught_exception;
	}
	var EXCEPTIONS = {
		last: 0,
		caught: [],
		infos: {},
		deAdjust: function (adjusted) {
			if (!adjusted || EXCEPTIONS.infos[adjusted]) return adjusted;
			for (var ptr in EXCEPTIONS.infos) {
				var info = EXCEPTIONS.infos[ptr];
				if (info.adjusted === adjusted) {
					return ptr;
				}
			}
			return adjusted;
		},
		addRef: function (ptr) {
			if (!ptr) return;
			var info = EXCEPTIONS.infos[ptr];
			info.refcount++;
		},
		decRef: function (ptr) {
			if (!ptr) return;
			var info = EXCEPTIONS.infos[ptr];
			assert(info.refcount > 0);
			info.refcount--;
			if (info.refcount === 0) {
				if (info.destructor) {
					Runtime.dynCall("vi", info.destructor, [ptr]);
				}
				delete EXCEPTIONS.infos[ptr];
				___cxa_free_exception(ptr);
			}
		},
		clearRef: function (ptr) {
			if (!ptr) return;
			var info = EXCEPTIONS.infos[ptr];
			info.refcount = 0;
		}
	};
	function ___resumeException(ptr) {
		if (!EXCEPTIONS.last) {
			EXCEPTIONS.last = ptr;
		}
		EXCEPTIONS.clearRef(EXCEPTIONS.deAdjust(ptr));
		throw ptr + " - Exception catching is disabled, this exception cannot be caught. Compile with -s DISABLE_EXCEPTION_CATCHING=0 or DISABLE_EXCEPTION_CATCHING=2 to catch.";
	}
	function ___cxa_find_matching_catch() {
		var thrown = EXCEPTIONS.last;
		if (!thrown) {
			return (asm["setTempRet0"](0), 0) | 0;
		}
		var info = EXCEPTIONS.infos[thrown];
		var throwntype = info.type;
		if (!throwntype) {
			return (asm["setTempRet0"](0), thrown) | 0;
		}
		var typeArray = Array.prototype.slice.call(arguments);
		var pointer = Module["___cxa_is_pointer_type"](throwntype);
		if (!___cxa_find_matching_catch.buffer) ___cxa_find_matching_catch.buffer = _malloc(4);
		HEAP32[___cxa_find_matching_catch.buffer >> 2] = thrown;
		thrown = ___cxa_find_matching_catch.buffer;
		for (var i = 0; i < typeArray.length; i++) {
			if (typeArray[i] && Module["___cxa_can_catch"](typeArray[i], throwntype, thrown)) {
				thrown = HEAP32[thrown >> 2];
				info.adjusted = thrown;
				return (asm["setTempRet0"](typeArray[i]), thrown) | 0;
			}
		}
		thrown = HEAP32[thrown >> 2];
		return (asm["setTempRet0"](throwntype), thrown) | 0;
	}
	function ___cxa_throw(ptr, type, destructor) {
		EXCEPTIONS.infos[ptr] = {
			ptr: ptr,
			adjusted: ptr,
			type: type,
			destructor: destructor,
			refcount: 0
		};
		EXCEPTIONS.last = ptr;
		if (!("uncaught_exception" in __ZSt18uncaught_exceptionv)) {
			__ZSt18uncaught_exceptionv.uncaught_exception = 1;
		} else {
			__ZSt18uncaught_exceptionv.uncaught_exception++;
		}
		throw ptr + " - Exception catching is disabled, this exception cannot be caught. Compile with -s DISABLE_EXCEPTION_CATCHING=0 or DISABLE_EXCEPTION_CATCHING=2 to catch.";
	}
	Module["_memset"] = _memset;
	var _BDtoILow = true;
	function getShiftFromSize(size) {
		switch (size) {
			case 1:
				return 0;

			case 2:
				return 1;

			case 4:
				return 2;

			case 8:
				return 3;

			default:
				throw new TypeError("Unknown type size: " + size);
		}
	}
	function __embind_register_bool(rawType, name, size, trueValue, falseValue) {
		var shift = getShiftFromSize(size);
		name = readLatin1String(name);
		registerType(rawType, {
			name: name,
			fromWireType: function (wt) {
				return !!wt;
			},
			toWireType: function (destructors, o) {
				return o ? trueValue : falseValue;
			},
			argPackAdvance: 8,
			readValueFromPointer: function (pointer) {
				var heap;
				if (size === 1) {
					heap = HEAP8;
				} else if (size === 2) {
					heap = HEAP16;
				} else if (size === 4) {
					heap = HEAP32;
				} else {
					throw new TypeError("Unknown boolean type size: " + name);
				}
				return this["fromWireType"](heap[pointer >> shift]);
			},
			destructorFunction: null
		});
	}
	Module["_bitshift64Shl"] = _bitshift64Shl;
	function _abort() {
		Module["abort"]();
	}
	function requireFunction(signature, rawFunction) {
		signature = readLatin1String(signature);
		function makeDynCaller(dynCall) {
			var args = [];
			for (var i = 1; i < signature.length; ++i) {
				args.push("a" + i);
			}
			var name = "dynCall_" + signature + "_" + rawFunction;
			var body = "return function " + name + "(" + args.join(", ") + ") {\n";
			body += "    return dynCall(rawFunction" + (args.length ? ", " : "") + args.join(", ") + ");\n";
			body += "};\n";
			return new Function("dynCall", "rawFunction", body)(dynCall, rawFunction);
		}
		var fp;
		if (Module["FUNCTION_TABLE_" + signature] !== undefined) {
			fp = Module["FUNCTION_TABLE_" + signature][rawFunction];
		} else if (typeof FUNCTION_TABLE !== "undefined") {
			fp = FUNCTION_TABLE[rawFunction];
		} else {
			var dc = asm["dynCall_" + signature];
			if (dc === undefined) {
				dc = asm["dynCall_" + signature.replace(/f/g, "d")];
				if (dc === undefined) {
					throwBindingError("No dynCall invoker for signature: " + signature);
				}
			}
			fp = makeDynCaller(dc);
		}
		if (typeof fp !== "function") {
			throwBindingError("unknown function pointer with signature " + signature + ": " + rawFunction);
		}
		return fp;
	}
	function runDestructors(destructors) {
		while (destructors.length) {
			var ptr = destructors.pop();
			var del = destructors.pop();
			del(ptr);
		}
	}
	var UnboundTypeError = undefined;
	function throwUnboundTypeError(message, types) {
		var unboundTypes = [];
		var seen = {};
		function visit(type) {
			if (seen[type]) {
				return;
			}
			if (registeredTypes[type]) {
				return;
			}
			if (typeDependencies[type]) {
				typeDependencies[type].forEach(visit);
				return;
			}
			unboundTypes.push(type);
			seen[type] = true;
		}
		types.forEach(visit);
		throw new UnboundTypeError(message + ": " + unboundTypes.map(getTypeName).join([", "]));
	}
	function upcastPointer(ptr, ptrClass, desiredClass) {
		while (ptrClass !== desiredClass) {
			if (!ptrClass.upcast) {
				throwBindingError("Expected null or instance of " + desiredClass.name + ", got an instance of " + ptrClass.name);
			}
			ptr = ptrClass.upcast(ptr);
			ptrClass = ptrClass.baseClass;
		}
		return ptr;
	}
	function validateThis(this_, classType, humanName) {
		if (!(this_ instanceof Object)) {
			throwBindingError(humanName + ' with invalid "this": ' + this_);
		}
		if (!(this_ instanceof classType.registeredClass.constructor)) {
			throwBindingError(humanName + ' incompatible with "this" of type ' + this_.constructor.name);
		}
		if (!this_.$$.ptr) {
			throwBindingError("cannot call emscripten binding method " + humanName + " on deleted object");
		}
		return upcastPointer(this_.$$.ptr, this_.$$.ptrType.registeredClass, classType.registeredClass);
	}
	function __embind_register_class_property(classType, fieldName, getterReturnType, getterSignature, getter, getterContext, setterArgumentType, setterSignature, setter, setterContext) {
		fieldName = readLatin1String(fieldName);
		getter = requireFunction(getterSignature, getter);
		whenDependentTypesAreResolved([], [classType], function (classType) {
			classType = classType[0];
			var humanName = classType.name + "." + fieldName;
			var desc = {
				get: function () {
					throwUnboundTypeError("Cannot access " + humanName + " due to unbound types", [getterReturnType, setterArgumentType]);
				},
				enumerable: true,
				configurable: true
			};
			if (setter) {
				desc.set = function () {
					throwUnboundTypeError("Cannot access " + humanName + " due to unbound types", [getterReturnType, setterArgumentType]);
				};
			} else {
				desc.set = function (v) {
					throwBindingError(humanName + " is a read-only property");
				};
			}
			Object.defineProperty(classType.registeredClass.instancePrototype, fieldName, desc);
			whenDependentTypesAreResolved([], setter ? [getterReturnType, setterArgumentType] : [getterReturnType], function (types) {
				var getterReturnType = types[0];
				var desc = {
					get: function () {
						var ptr = validateThis(this, classType, humanName + " getter");
						return getterReturnType["fromWireType"](getter(getterContext, ptr));
					},
					enumerable: true
				};
				if (setter) {
					setter = requireFunction(setterSignature, setter);
					var setterArgumentType = types[1];
					desc.set = function (v) {
						var ptr = validateThis(this, classType, humanName + " setter");
						var destructors = [];
						setter(setterContext, ptr, setterArgumentType["toWireType"](destructors, v));
						runDestructors(destructors);
					};
				}
				Object.defineProperty(classType.registeredClass.instancePrototype, fieldName, desc);
				return [];
			});
			return [];
		});
	}
	function __free() { }
	Module["_free"] = __free;
	function __malloc(bytes) {
		var ptr = Runtime.dynamicAlloc(bytes + 8);
		return ptr + 8 & 4294967288;
	}
	Module["_malloc"] = __malloc;
	function simpleReadValueFromPointer(pointer) {
		return this["fromWireType"](HEAPU32[pointer >> 2]);
	}
	function __embind_register_std_string(rawType, name) {
		name = readLatin1String(name);
		registerType(rawType, {
			name: name,
			fromWireType: function (value) {
				var length = HEAPU32[value >> 2];
				var a = new Array(length);
				for (var i = 0; i < length; ++i) {
					a[i] = String.fromCharCode(HEAPU8[value + 4 + i]);
				}
				_free(value);
				return a.join("");
			},
			toWireType: function (destructors, value) {
				if (value instanceof ArrayBuffer) {
					value = new Uint8Array(value);
				}
				function getTAElement(ta, index) {
					return ta[index];
				}
				function getStringElement(string, index) {
					return string.charCodeAt(index);
				}
				var getElement;
				if (value instanceof Uint8Array) {
					getElement = getTAElement;
				} else if (value instanceof Int8Array) {
					getElement = getTAElement;
				} else if (typeof value === "string") {
					getElement = getStringElement;
				} else {
					throwBindingError("Cannot pass non-string to std::string");
				}
				var length = value.length;
				var ptr = _malloc(4 + length);
				HEAPU32[ptr >> 2] = length;
				for (var i = 0; i < length; ++i) {
					var charCode = getElement(value, i);
					if (charCode > 255) {
						_free(ptr);
						throwBindingError("String has UTF-16 code units that do not fit in 8 bits");
					}
					HEAPU8[ptr + 4 + i] = charCode;
				}
				if (destructors !== null) {
					destructors.push(_free, ptr);
				}
				return ptr;
			},
			argPackAdvance: 8,
			readValueFromPointer: simpleReadValueFromPointer,
			destructorFunction: function (ptr) {
				_free(ptr);
			}
		});
	}
	function __embind_register_std_wstring(rawType, charSize, name) {
		name = readLatin1String(name);
		var getHeap, shift;
		if (charSize === 2) {
			getHeap = function () {
				return HEAPU16;
			};
			shift = 1;
		} else if (charSize === 4) {
			getHeap = function () {
				return HEAPU32;
			};
			shift = 2;
		}
		registerType(rawType, {
			name: name,
			fromWireType: function (value) {
				var HEAP = getHeap();
				var length = HEAPU32[value >> 2];
				var a = new Array(length);
				var start = value + 4 >> shift;
				for (var i = 0; i < length; ++i) {
					a[i] = String.fromCharCode(HEAP[start + i]);
				}
				_free(value);
				return a.join("");
			},
			toWireType: function (destructors, value) {
				var HEAP = getHeap();
				var length = value.length;
				var ptr = _malloc(4 + length * charSize);
				HEAPU32[ptr >> 2] = length;
				var start = ptr + 4 >> shift;
				for (var i = 0; i < length; ++i) {
					HEAP[start + i] = value.charCodeAt(i);
				}
				if (destructors !== null) {
					destructors.push(_free, ptr);
				}
				return ptr;
			},
			argPackAdvance: 8,
			readValueFromPointer: simpleReadValueFromPointer,
			destructorFunction: function (ptr) {
				_free(ptr);
			}
		});
	}
	function _pthread_once(ptr, func) {
		if (!_pthread_once.seen) _pthread_once.seen = {};
		if (ptr in _pthread_once.seen) return;
		Runtime.dynCall("v", func);
		_pthread_once.seen[ptr] = 1;
	}
	function ClassHandle_isAliasOf(other) {
		if (!(this instanceof ClassHandle)) {
			return false;
		}
		if (!(other instanceof ClassHandle)) {
			return false;
		}
		var leftClass = this.$$.ptrType.registeredClass;
		var left = this.$$.ptr;
		var rightClass = other.$$.ptrType.registeredClass;
		var right = other.$$.ptr;
		while (leftClass.baseClass) {
			left = leftClass.upcast(left);
			leftClass = leftClass.baseClass;
		}
		while (rightClass.baseClass) {
			right = rightClass.upcast(right);
			rightClass = rightClass.baseClass;
		}
		return leftClass === rightClass && left === right;
	}
	function shallowCopyInternalPointer(o) {
		return {
			count: o.count,
			deleteScheduled: o.deleteScheduled,
			preservePointerOnDelete: o.preservePointerOnDelete,
			ptr: o.ptr,
			ptrType: o.ptrType,
			smartPtr: o.smartPtr,
			smartPtrType: o.smartPtrType
		};
	}
	function throwInstanceAlreadyDeleted(obj) {
		function getInstanceTypeName(handle) {
			return handle.$$.ptrType.registeredClass.name;
		}
		throwBindingError(getInstanceTypeName(obj) + " instance already deleted");
	}
	function ClassHandle_clone() {
		if (!this.$$.ptr) {
			throwInstanceAlreadyDeleted(this);
		}
		if (this.$$.preservePointerOnDelete) {
			this.$$.count.value += 1;
			return this;
		} else {
			var clone = Object.create(Object.getPrototypeOf(this), {
				$$: {
					value: shallowCopyInternalPointer(this.$$)
				}
			});
			clone.$$.count.value += 1;
			clone.$$.deleteScheduled = false;
			return clone;
		}
	}
	function runDestructor(handle) {
		var $$ = handle.$$;
		if ($$.smartPtr) {
			$$.smartPtrType.rawDestructor($$.smartPtr);
		} else {
			$$.ptrType.registeredClass.rawDestructor($$.ptr);
		}
	}
	function ClassHandle_delete() {
		if (!this.$$.ptr) {
			throwInstanceAlreadyDeleted(this);
		}
		if (this.$$.deleteScheduled && !this.$$.preservePointerOnDelete) {
			throwBindingError("Object already scheduled for deletion");
		}
		this.$$.count.value -= 1;
		var toDelete = 0 === this.$$.count.value;
		if (toDelete) {
			runDestructor(this);
		}
		if (!this.$$.preservePointerOnDelete) {
			this.$$.smartPtr = undefined;
			this.$$.ptr = undefined;
		}
	}
	function ClassHandle_isDeleted() {
		return !this.$$.ptr;
	}
	var delayFunction = undefined;
	var deletionQueue = [];
	function flushPendingDeletes() {
		while (deletionQueue.length) {
			var obj = deletionQueue.pop();
			obj.$$.deleteScheduled = false;
			obj["delete"]();
		}
	}
	function ClassHandle_deleteLater() {
		if (!this.$$.ptr) {
			throwInstanceAlreadyDeleted(this);
		}
		if (this.$$.deleteScheduled && !this.$$.preservePointerOnDelete) {
			throwBindingError("Object already scheduled for deletion");
		}
		deletionQueue.push(this);
		if (deletionQueue.length === 1 && delayFunction) {
			delayFunction(flushPendingDeletes);
		}
		this.$$.deleteScheduled = true;
		return this;
	}
	function init_ClassHandle() {
		ClassHandle.prototype["isAliasOf"] = ClassHandle_isAliasOf;
		ClassHandle.prototype["clone"] = ClassHandle_clone;
		ClassHandle.prototype["delete"] = ClassHandle_delete;
		ClassHandle.prototype["isDeleted"] = ClassHandle_isDeleted;
		ClassHandle.prototype["deleteLater"] = ClassHandle_deleteLater;
	}
	function ClassHandle() { }
	var registeredPointers = {};
	function ensureOverloadTable(proto, methodName, humanName) {
		if (undefined === proto[methodName].overloadTable) {
			var prevFunc = proto[methodName];
			proto[methodName] = function () {
				if (!proto[methodName].overloadTable.hasOwnProperty(arguments.length)) {
					throwBindingError("Function '" + humanName + "' called with an invalid number of arguments (" + arguments.length + ") - expects one of (" + proto[methodName].overloadTable + ")!");
				}
				return proto[methodName].overloadTable[arguments.length].apply(this, arguments);
			};
			proto[methodName].overloadTable = [];
			proto[methodName].overloadTable[prevFunc.argCount] = prevFunc;
		}
	}
	function exposePublicSymbol(name, value, numArguments) {
		if (Module.hasOwnProperty(name)) {
			if (undefined === numArguments || undefined !== Module[name].overloadTable && undefined !== Module[name].overloadTable[numArguments]) {
				throwBindingError("Cannot register public name '" + name + "' twice");
			}
			ensureOverloadTable(Module, name, name);
			if (Module.hasOwnProperty(numArguments)) {
				throwBindingError("Cannot register multiple overloads of a function with the same number of arguments (" + numArguments + ")!");
			}
			Module[name].overloadTable[numArguments] = value;
		} else {
			Module[name] = value;
			if (undefined !== numArguments) {
				Module[name].numArguments = numArguments;
			}
		}
	}
	function RegisteredClass(name, constructor, instancePrototype, rawDestructor, baseClass, getActualType, upcast, downcast) {
		this.name = name;
		this.constructor = constructor;
		this.instancePrototype = instancePrototype;
		this.rawDestructor = rawDestructor;
		this.baseClass = baseClass;
		this.getActualType = getActualType;
		this.upcast = upcast;
		this.downcast = downcast;
		this.pureVirtualFunctions = [];
	}
	function constNoSmartPtrRawPointerToWireType(destructors, handle) {
		if (handle === null) {
			if (this.isReference) {
				throwBindingError("null is not a valid " + this.name);
			}
			return 0;
		}
		if (!handle.$$) {
			throwBindingError('Cannot pass "' + _embind_repr(handle) + '" as a ' + this.name);
		}
		if (!handle.$$.ptr) {
			throwBindingError("Cannot pass deleted object as a pointer of type " + this.name);
		}
		var handleClass = handle.$$.ptrType.registeredClass;
		var ptr = upcastPointer(handle.$$.ptr, handleClass, this.registeredClass);
		return ptr;
	}
	function genericPointerToWireType(destructors, handle) {
		if (handle === null) {
			if (this.isReference) {
				throwBindingError("null is not a valid " + this.name);
			}
			if (this.isSmartPointer) {
				var ptr = this.rawConstructor();
				if (destructors !== null) {
					destructors.push(this.rawDestructor, ptr);
				}
				return ptr;
			} else {
				return 0;
			}
		}
		if (!handle.$$) {
			throwBindingError('Cannot pass "' + _embind_repr(handle) + '" as a ' + this.name);
		}
		if (!handle.$$.ptr) {
			throwBindingError("Cannot pass deleted object as a pointer of type " + this.name);
		}
		if (!this.isConst && handle.$$.ptrType.isConst) {
			throwBindingError("Cannot convert argument of type " + (handle.$$.smartPtrType ? handle.$$.smartPtrType.name : handle.$$.ptrType.name) + " to parameter type " + this.name);
		}
		var handleClass = handle.$$.ptrType.registeredClass;
		var ptr = upcastPointer(handle.$$.ptr, handleClass, this.registeredClass);
		if (this.isSmartPointer) {
			if (undefined === handle.$$.smartPtr) {
				throwBindingError("Passing raw pointer to smart pointer is illegal");
			}
			switch (this.sharingPolicy) {
				case 0:
					if (handle.$$.smartPtrType === this) {
						ptr = handle.$$.smartPtr;
					} else {
						throwBindingError("Cannot convert argument of type " + (handle.$$.smartPtrType ? handle.$$.smartPtrType.name : handle.$$.ptrType.name) + " to parameter type " + this.name);
					}
					break;

				case 1:
					ptr = handle.$$.smartPtr;
					break;

				case 2:
					if (handle.$$.smartPtrType === this) {
						ptr = handle.$$.smartPtr;
					} else {
						var clonedHandle = handle["clone"]();
						ptr = this.rawShare(ptr, __emval_register(function () {
							clonedHandle["delete"]();
						}));
						if (destructors !== null) {
							destructors.push(this.rawDestructor, ptr);
						}
					}
					break;

				default:
					throwBindingError("Unsupporting sharing policy");
			}
		}
		return ptr;
	}
	function nonConstNoSmartPtrRawPointerToWireType(destructors, handle) {
		if (handle === null) {
			if (this.isReference) {
				throwBindingError("null is not a valid " + this.name);
			}
			return 0;
		}
		if (!handle.$$) {
			throwBindingError('Cannot pass "' + _embind_repr(handle) + '" as a ' + this.name);
		}
		if (!handle.$$.ptr) {
			throwBindingError("Cannot pass deleted object as a pointer of type " + this.name);
		}
		if (handle.$$.ptrType.isConst) {
			throwBindingError("Cannot convert argument of type " + handle.$$.ptrType.name + " to parameter type " + this.name);
		}
		var handleClass = handle.$$.ptrType.registeredClass;
		var ptr = upcastPointer(handle.$$.ptr, handleClass, this.registeredClass);
		return ptr;
	}
	function RegisteredPointer_getPointee(ptr) {
		if (this.rawGetPointee) {
			ptr = this.rawGetPointee(ptr);
		}
		return ptr;
	}
	function RegisteredPointer_destructor(ptr) {
		if (this.rawDestructor) {
			this.rawDestructor(ptr);
		}
	}
	function RegisteredPointer_deleteObject(handle) {
		if (handle !== null) {
			handle["delete"]();
		}
	}
	function downcastPointer(ptr, ptrClass, desiredClass) {
		if (ptrClass === desiredClass) {
			return ptr;
		}
		if (undefined === desiredClass.baseClass) {
			return null;
		}
		var rv = downcastPointer(ptr, ptrClass, desiredClass.baseClass);
		if (rv === null) {
			return null;
		}
		return desiredClass.downcast(rv);
	}
	function getInheritedInstanceCount() {
		return Object.keys(registeredInstances).length;
	}
	function getLiveInheritedInstances() {
		var rv = [];
		for (var k in registeredInstances) {
			if (registeredInstances.hasOwnProperty(k)) {
				rv.push(registeredInstances[k]);
			}
		}
		return rv;
	}
	function setDelayFunction(fn) {
		delayFunction = fn;
		if (deletionQueue.length && delayFunction) {
			delayFunction(flushPendingDeletes);
		}
	}
	function init_embind() {
		Module["getInheritedInstanceCount"] = getInheritedInstanceCount;
		Module["getLiveInheritedInstances"] = getLiveInheritedInstances;
		Module["flushPendingDeletes"] = flushPendingDeletes;
		Module["setDelayFunction"] = setDelayFunction;
	}
	var registeredInstances = {};
	function getBasestPointer(class_, ptr) {
		if (ptr === undefined) {
			throwBindingError("ptr should not be undefined");
		}
		while (class_.baseClass) {
			ptr = class_.upcast(ptr);
			class_ = class_.baseClass;
		}
		return ptr;
	}
	function getInheritedInstance(class_, ptr) {
		ptr = getBasestPointer(class_, ptr);
		return registeredInstances[ptr];
	}
	var _throwInternalError = undefined;
	function makeClassHandle(prototype, record) {
		if (!record.ptrType || !record.ptr) {
			throwInternalError("makeClassHandle requires ptr and ptrType");
		}
		var hasSmartPtrType = !!record.smartPtrType;
		var hasSmartPtr = !!record.smartPtr;
		if (hasSmartPtrType !== hasSmartPtr) {
			throwInternalError("Both smartPtrType and smartPtr must be specified");
		}
		record.count = {
			value: 1
		};
		return Object.create(prototype, {
			$$: {
				value: record
			}
		});
	}
	function RegisteredPointer_fromWireType(ptr) {
		var rawPointer = this.getPointee(ptr);
		if (!rawPointer) {
			this.destructor(ptr);
			return null;
		}
		var registeredInstance = getInheritedInstance(this.registeredClass, rawPointer);
		if (undefined !== registeredInstance) {
			if (0 === registeredInstance.$$.count.value) {
				registeredInstance.$$.ptr = rawPointer;
				registeredInstance.$$.smartPtr = ptr;
				return registeredInstance["clone"]();
			} else {
				var rv = registeredInstance["clone"]();
				this.destructor(ptr);
				return rv;
			}
		}
		function makeDefaultHandle() {
			if (this.isSmartPointer) {
				return makeClassHandle(this.registeredClass.instancePrototype, {
					ptrType: this.pointeeType,
					ptr: rawPointer,
					smartPtrType: this,
					smartPtr: ptr
				});
			} else {
				return makeClassHandle(this.registeredClass.instancePrototype, {
					ptrType: this,
					ptr: ptr
				});
			}
		}
		var actualType = this.registeredClass.getActualType(rawPointer);
		var registeredPointerRecord = registeredPointers[actualType];
		if (!registeredPointerRecord) {
			return makeDefaultHandle.call(this);
		}
		var toType;
		if (this.isConst) {
			toType = registeredPointerRecord.constPointerType;
		} else {
			toType = registeredPointerRecord.pointerType;
		}
		var dp = downcastPointer(rawPointer, this.registeredClass, toType.registeredClass);
		if (dp === null) {
			return makeDefaultHandle.call(this);
		}
		if (this.isSmartPointer) {
			return makeClassHandle(toType.registeredClass.instancePrototype, {
				ptrType: toType,
				ptr: dp,
				smartPtrType: this,
				smartPtr: ptr
			});
		} else {
			return makeClassHandle(toType.registeredClass.instancePrototype, {
				ptrType: toType,
				ptr: dp
			});
		}
	}
	function init_RegisteredPointer() {
		RegisteredPointer.prototype.getPointee = RegisteredPointer_getPointee;
		RegisteredPointer.prototype.destructor = RegisteredPointer_destructor;
		RegisteredPointer.prototype["argPackAdvance"] = 8;
		RegisteredPointer.prototype["readValueFromPointer"] = simpleReadValueFromPointer;
		RegisteredPointer.prototype["deleteObject"] = RegisteredPointer_deleteObject;
		RegisteredPointer.prototype["fromWireType"] = RegisteredPointer_fromWireType;
	}
	function RegisteredPointer(name, registeredClass, isReference, isConst, isSmartPointer, pointeeType, sharingPolicy, rawGetPointee, rawConstructor, rawShare, rawDestructor) {
		this.name = name;
		this.registeredClass = registeredClass;
		this.isReference = isReference;
		this.isConst = isConst;
		this.isSmartPointer = isSmartPointer;
		this.pointeeType = pointeeType;
		this.sharingPolicy = sharingPolicy;
		this.rawGetPointee = rawGetPointee;
		this.rawConstructor = rawConstructor;
		this.rawShare = rawShare;
		this.rawDestructor = rawDestructor;
		if (!isSmartPointer && registeredClass.baseClass === undefined) {
			if (isConst) {
				this["toWireType"] = constNoSmartPtrRawPointerToWireType;
				this.destructorFunction = null;
			} else {
				this["toWireType"] = nonConstNoSmartPtrRawPointerToWireType;
				this.destructorFunction = null;
			}
		} else {
			this["toWireType"] = genericPointerToWireType;
		}
	}
	function replacePublicSymbol(name, value, numArguments) {
		if (!Module.hasOwnProperty(name)) {
			throwInternalError("Replacing nonexistant public symbol");
		}
		if (undefined !== Module[name].overloadTable && undefined !== numArguments) {
			Module[name].overloadTable[numArguments] = value;
		} else {
			Module[name] = value;
		}
	}
	function __embind_register_class(rawType, rawPointerType, rawConstPointerType, baseClassRawType, getActualTypeSignature, getActualType, upcastSignature, upcast, downcastSignature, downcast, name, destructorSignature, rawDestructor) {
		name = readLatin1String(name);
		getActualType = requireFunction(getActualTypeSignature, getActualType);
		if (upcast) {
			upcast = requireFunction(upcastSignature, upcast);
		}
		if (downcast) {
			downcast = requireFunction(downcastSignature, downcast);
		}
		rawDestructor = requireFunction(destructorSignature, rawDestructor);
		var legalFunctionName = makeLegalFunctionName(name);
		exposePublicSymbol(legalFunctionName, function () {
			throwUnboundTypeError("Cannot construct " + name + " due to unbound types", [baseClassRawType]);
		});
		whenDependentTypesAreResolved([rawType, rawPointerType, rawConstPointerType], baseClassRawType ? [baseClassRawType] : [], function (base) {
			base = base[0];
			var baseClass;
			var basePrototype;
			if (baseClassRawType) {
				baseClass = base.registeredClass;
				basePrototype = baseClass.instancePrototype;
			} else {
				basePrototype = ClassHandle.prototype;
			}
			var constructor = createNamedFunction(legalFunctionName, function () {
				if (Object.getPrototypeOf(this) !== instancePrototype) {
					throw new BindingError("Use 'new' to construct " + name);
				}
				if (undefined === registeredClass.constructor_body) {
					throw new BindingError(name + " has no accessible constructor");
				}
				var body = registeredClass.constructor_body[arguments.length];
				if (undefined === body) {
					throw new BindingError("Tried to invoke ctor of " + name + " with invalid number of parameters (" + arguments.length + ") - expected (" + Object.keys(registeredClass.constructor_body).toString() + ") parameters instead!");
				}
				return body.apply(this, arguments);
			});
			var instancePrototype = Object.create(basePrototype, {
				constructor: {
					value: constructor
				}
			});
			constructor.prototype = instancePrototype;
			var registeredClass = new RegisteredClass(name, constructor, instancePrototype, rawDestructor, baseClass, getActualType, upcast, downcast);
			var referenceConverter = new RegisteredPointer(name, registeredClass, true, false, false);
			var pointerConverter = new RegisteredPointer(name + "*", registeredClass, false, false, false);
			var constPointerConverter = new RegisteredPointer(name + " const*", registeredClass, false, true, false);
			registeredPointers[rawType] = {
				pointerType: pointerConverter,
				constPointerType: constPointerConverter
			};
			replacePublicSymbol(legalFunctionName, constructor);
			return [referenceConverter, pointerConverter, constPointerConverter];
		});
	}
	Module["_strlen"] = _strlen;
	var emval_free_list = [];
	var emval_handle_array = [{}, {
		value: undefined
	}, {
			value: null
		}, {
			value: true
		}, {
			value: false
		}];
	function __emval_decref(handle) {
		if (handle > 4 && 0 === --emval_handle_array[handle].refcount) {
			emval_handle_array[handle] = undefined;
			emval_free_list.push(handle);
		}
	}
	var ERRNO_CODES = {
		EPERM: 1,
		ENOENT: 2,
		ESRCH: 3,
		EINTR: 4,
		EIO: 5,
		ENXIO: 6,
		E2BIG: 7,
		ENOEXEC: 8,
		EBADF: 9,
		ECHILD: 10,
		EAGAIN: 11,
		EWOULDBLOCK: 11,
		ENOMEM: 12,
		EACCES: 13,
		EFAULT: 14,
		ENOTBLK: 15,
		EBUSY: 16,
		EEXIST: 17,
		EXDEV: 18,
		ENODEV: 19,
		ENOTDIR: 20,
		EISDIR: 21,
		EINVAL: 22,
		ENFILE: 23,
		EMFILE: 24,
		ENOTTY: 25,
		ETXTBSY: 26,
		EFBIG: 27,
		ENOSPC: 28,
		ESPIPE: 29,
		EROFS: 30,
		EMLINK: 31,
		EPIPE: 32,
		EDOM: 33,
		ERANGE: 34,
		ENOMSG: 42,
		EIDRM: 43,
		ECHRNG: 44,
		EL2NSYNC: 45,
		EL3HLT: 46,
		EL3RST: 47,
		ELNRNG: 48,
		EUNATCH: 49,
		ENOCSI: 50,
		EL2HLT: 51,
		EDEADLK: 35,
		ENOLCK: 37,
		EBADE: 52,
		EBADR: 53,
		EXFULL: 54,
		ENOANO: 55,
		EBADRQC: 56,
		EBADSLT: 57,
		EDEADLOCK: 35,
		EBFONT: 59,
		ENOSTR: 60,
		ENODATA: 61,
		ETIME: 62,
		ENOSR: 63,
		ENONET: 64,
		ENOPKG: 65,
		EREMOTE: 66,
		ENOLINK: 67,
		EADV: 68,
		ESRMNT: 69,
		ECOMM: 70,
		EPROTO: 71,
		EMULTIHOP: 72,
		EDOTDOT: 73,
		EBADMSG: 74,
		ENOTUNIQ: 76,
		EBADFD: 77,
		EREMCHG: 78,
		ELIBACC: 79,
		ELIBBAD: 80,
		ELIBSCN: 81,
		ELIBMAX: 82,
		ELIBEXEC: 83,
		ENOSYS: 38,
		ENOTEMPTY: 39,
		ENAMETOOLONG: 36,
		ELOOP: 40,
		EOPNOTSUPP: 95,
		EPFNOSUPPORT: 96,
		ECONNRESET: 104,
		ENOBUFS: 105,
		EAFNOSUPPORT: 97,
		EPROTOTYPE: 91,
		ENOTSOCK: 88,
		ENOPROTOOPT: 92,
		ESHUTDOWN: 108,
		ECONNREFUSED: 111,
		EADDRINUSE: 98,
		ECONNABORTED: 103,
		ENETUNREACH: 101,
		ENETDOWN: 100,
		ETIMEDOUT: 110,
		EHOSTDOWN: 112,
		EHOSTUNREACH: 113,
		EINPROGRESS: 115,
		EALREADY: 114,
		EDESTADDRREQ: 89,
		EMSGSIZE: 90,
		EPROTONOSUPPORT: 93,
		ESOCKTNOSUPPORT: 94,
		EADDRNOTAVAIL: 99,
		ENETRESET: 102,
		EISCONN: 106,
		ENOTCONN: 107,
		ETOOMANYREFS: 109,
		EUSERS: 87,
		EDQUOT: 122,
		ESTALE: 116,
		ENOTSUP: 95,
		ENOMEDIUM: 123,
		EILSEQ: 84,
		EOVERFLOW: 75,
		ECANCELED: 125,
		ENOTRECOVERABLE: 131,
		EOWNERDEAD: 130,
		ESTRPIPE: 86
	};
	var ERRNO_MESSAGES = {
		0: "Success",
		1: "Not super-user",
		2: "No such file or directory",
		3: "No such process",
		4: "Interrupted system call",
		5: "I/O error",
		6: "No such device or address",
		7: "Arg list too long",
		8: "Exec format error",
		9: "Bad file number",
		10: "No children",
		11: "No more processes",
		12: "Not enough core",
		13: "Permission denied",
		14: "Bad address",
		15: "Block device required",
		16: "Mount device busy",
		17: "File exists",
		18: "Cross-device link",
		19: "No such device",
		20: "Not a directory",
		21: "Is a directory",
		22: "Invalid argument",
		23: "Too many open files in system",
		24: "Too many open files",
		25: "Not a typewriter",
		26: "Text file busy",
		27: "File too large",
		28: "No space left on device",
		29: "Illegal seek",
		30: "Read only file system",
		31: "Too many links",
		32: "Broken pipe",
		33: "Math arg out of domain of func",
		34: "Math result not representable",
		35: "File locking deadlock error",
		36: "File or path name too long",
		37: "No record locks available",
		38: "Function not implemented",
		39: "Directory not empty",
		40: "Too many symbolic links",
		42: "No message of desired type",
		43: "Identifier removed",
		44: "Channel number out of range",
		45: "Level 2 not synchronized",
		46: "Level 3 halted",
		47: "Level 3 reset",
		48: "Link number out of range",
		49: "Protocol driver not attached",
		50: "No CSI structure available",
		51: "Level 2 halted",
		52: "Invalid exchange",
		53: "Invalid request descriptor",
		54: "Exchange full",
		55: "No anode",
		56: "Invalid request code",
		57: "Invalid slot",
		59: "Bad font file fmt",
		60: "Device not a stream",
		61: "No data (for no delay io)",
		62: "Timer expired",
		63: "Out of streams resources",
		64: "Machine is not on the network",
		65: "Package not installed",
		66: "The object is remote",
		67: "The link has been severed",
		68: "Advertise error",
		69: "Srmount error",
		70: "Communication error on send",
		71: "Protocol error",
		72: "Multihop attempted",
		73: "Cross mount point (not really error)",
		74: "Trying to read unreadable message",
		75: "Value too large for defined data type",
		76: "Given log. name not unique",
		77: "f.d. invalid for this operation",
		78: "Remote address changed",
		79: "Can   access a needed shared lib",
		80: "Accessing a corrupted shared lib",
		81: ".lib section in a.out corrupted",
		82: "Attempting to link in too many libs",
		83: "Attempting to exec a shared library",
		84: "Illegal byte sequence",
		86: "Streams pipe error",
		87: "Too many users",
		88: "Socket operation on non-socket",
		89: "Destination address required",
		90: "Message too long",
		91: "Protocol wrong type for socket",
		92: "Protocol not available",
		93: "Unknown protocol",
		94: "Socket type not supported",
		95: "Not supported",
		96: "Protocol family not supported",
		97: "Address family not supported by protocol family",
		98: "Address already in use",
		99: "Address not available",
		100: "Network interface is not configured",
		101: "Network is unreachable",
		102: "Connection reset by network",
		103: "Connection aborted",
		104: "Connection reset by peer",
		105: "No buffer space available",
		106: "Socket is already connected",
		107: "Socket is not connected",
		108: "Can't send after socket shutdown",
		109: "Too many references",
		110: "Connection timed out",
		111: "Connection refused",
		112: "Host is down",
		113: "Host is unreachable",
		114: "Socket already connected",
		115: "Connection already in progress",
		116: "Stale file handle",
		122: "Quota exceeded",
		123: "No medium (in tape drive)",
		125: "Operation canceled",
		130: "Previous owner died",
		131: "State not recoverable"
	};
	var ___errno_state = 0;
	function ___setErrNo(value) {
		HEAP32[___errno_state >> 2] = value;
		return value;
	}
	var PATH = {
		splitPath: function (filename) {
			var splitPathRe = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
			return splitPathRe.exec(filename).slice(1);
		},
		normalizeArray: function (parts, allowAboveRoot) {
			var up = 0;
			for (var i = parts.length - 1; i >= 0; i--) {
				var last = parts[i];
				if (last === ".") {
					parts.splice(i, 1);
				} else if (last === "..") {
					parts.splice(i, 1);
					up++;
				} else if (up) {
					parts.splice(i, 1);
					up--;
				}
			}
			if (allowAboveRoot) {
				for (; up--; up) {
					parts.unshift("..");
				}
			}
			return parts;
		},
		normalize: function (path) {
			var isAbsolute = path.charAt(0) === "/", trailingSlash = path.substr(-1) === "/";
			path = PATH.normalizeArray(path.split("/").filter(function (p) {
				return !!p;
			}), !isAbsolute).join("/");
			if (!path && !isAbsolute) {
				path = ".";
			}
			if (path && trailingSlash) {
				path += "/";
			}
			return (isAbsolute ? "/" : "") + path;
		},
		dirname: function (path) {
			var result = PATH.splitPath(path), root = result[0], dir = result[1];
			if (!root && !dir) {
				return ".";
			}
			if (dir) {
				dir = dir.substr(0, dir.length - 1);
			}
			return root + dir;
		},
		basename: function (path) {
			if (path === "/") return "/";
			var lastSlash = path.lastIndexOf("/");
			if (lastSlash === -1) return path;
			return path.substr(lastSlash + 1);
		},
		extname: function (path) {
			return PATH.splitPath(path)[3];
		},
		join: function () {
			var paths = Array.prototype.slice.call(arguments, 0);
			return PATH.normalize(paths.join("/"));
		},
		join2: function (l, r) {
			return PATH.normalize(l + "/" + r);
		},
		resolve: function () {
			var resolvedPath = "", resolvedAbsolute = false;
			for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
				var path = i >= 0 ? arguments[i] : FS.cwd();
				if (typeof path !== "string") {
					throw new TypeError("Arguments to path.resolve must be strings");
				} else if (!path) {
					return "";
				}
				resolvedPath = path + "/" + resolvedPath;
				resolvedAbsolute = path.charAt(0) === "/";
			}
			resolvedPath = PATH.normalizeArray(resolvedPath.split("/").filter(function (p) {
				return !!p;
			}), !resolvedAbsolute).join("/");
			return (resolvedAbsolute ? "/" : "") + resolvedPath || ".";
		},
		relative: function (from, to) {
			from = PATH.resolve(from).substr(1);
			to = PATH.resolve(to).substr(1);
			function trim(arr) {
				var start = 0;
				for (; start < arr.length; start++) {
					if (arr[start] !== "") break;
				}
				var end = arr.length - 1;
				for (; end >= 0; end--) {
					if (arr[end] !== "") break;
				}
				if (start > end) return [];
				return arr.slice(start, end - start + 1);
			}
			var fromParts = trim(from.split("/"));
			var toParts = trim(to.split("/"));
			var length = Math.min(fromParts.length, toParts.length);
			var samePartsLength = length;
			for (var i = 0; i < length; i++) {
				if (fromParts[i] !== toParts[i]) {
					samePartsLength = i;
					break;
				}
			}
			var outputParts = [];
			for (var i = samePartsLength; i < fromParts.length; i++) {
				outputParts.push("..");
			}
			outputParts = outputParts.concat(toParts.slice(samePartsLength));
			return outputParts.join("/");
		}
	};
	var TTY = {
		ttys: [],
		init: function () { },
		shutdown: function () { },
		register: function (dev, ops) {
			TTY.ttys[dev] = {
				input: [],
				output: [],
				ops: ops
			};
			FS.registerDevice(dev, TTY.stream_ops);
		},
		stream_ops: {
			open: function (stream) {
				var tty = TTY.ttys[stream.node.rdev];
				if (!tty) {
					throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
				}
				stream.tty = tty;
				stream.seekable = false;
			},
			close: function (stream) {
				stream.tty.ops.flush(stream.tty);
			},
			flush: function (stream) {
				stream.tty.ops.flush(stream.tty);
			},
			read: function (stream, buffer, offset, length, pos) {
				if (!stream.tty || !stream.tty.ops.get_char) {
					throw new FS.ErrnoError(ERRNO_CODES.ENXIO);
				}
				var bytesRead = 0;
				for (var i = 0; i < length; i++) {
					var result;
					try {
						result = stream.tty.ops.get_char(stream.tty);
					} catch (e) {
						throw new FS.ErrnoError(ERRNO_CODES.EIO);
					}
					if (result === undefined && bytesRead === 0) {
						throw new FS.ErrnoError(ERRNO_CODES.EAGAIN);
					}
					if (result === null || result === undefined) break;
					bytesRead++;
					buffer[offset + i] = result;
				}
				if (bytesRead) {
					stream.node.timestamp = Date.now();
				}
				return bytesRead;
			},
			write: function (stream, buffer, offset, length, pos) {
				if (!stream.tty || !stream.tty.ops.put_char) {
					throw new FS.ErrnoError(ERRNO_CODES.ENXIO);
				}
				for (var i = 0; i < length; i++) {
					try {
						stream.tty.ops.put_char(stream.tty, buffer[offset + i]);
					} catch (e) {
						throw new FS.ErrnoError(ERRNO_CODES.EIO);
					}
				}
				if (length) {
					stream.node.timestamp = Date.now();
				}
				return i;
			}
		},
		default_tty_ops: {
			get_char: function (tty) {
				if (!tty.input.length) {
					var result = null;
					if (ENVIRONMENT_IS_NODE) {
						var BUFSIZE = 256;
						var buf = new Buffer(BUFSIZE);
						var bytesRead = 0;
						var fd = process.stdin.fd;
						var usingDevice = false;
						try {
							fd = fs.openSync("/dev/stdin", "r");
							usingDevice = true;
						} catch (e) { }
						bytesRead = fs.readSync(fd, buf, 0, BUFSIZE, null);
						if (usingDevice) {
							fs.closeSync(fd);
						}
						if (bytesRead > 0) {
							result = buf.slice(0, bytesRead).toString("utf-8");
						} else {
							result = null;
						}
					} else if (typeof window != "undefined" && typeof window.prompt == "function") {
						result = window.prompt("Input: ");
						if (result !== null) {
							result += "\n";
						}
					} else if (typeof readline == "function") {
						result = readline();
						if (result !== null) {
							result += "\n";
						}
					}
					if (!result) {
						return null;
					}
					tty.input = intArrayFromString(result, true);
				}
				return tty.input.shift();
			},
			put_char: function (tty, val) {
				if (val === null || val === 10) {
					Module["print"](UTF8ArrayToString(tty.output, 0));
					tty.output = [];
				} else {
					if (val != 0) tty.output.push(val);
				}
			},
			flush: function (tty) {
				if (tty.output && tty.output.length > 0) {
					Module["print"](UTF8ArrayToString(tty.output, 0));
					tty.output = [];
				}
			}
		},
		default_tty1_ops: {
			put_char: function (tty, val) {
				if (val === null || val === 10) {
					Module["printErr"](UTF8ArrayToString(tty.output, 0));
					tty.output = [];
				} else {
					if (val != 0) tty.output.push(val);
				}
			},
			flush: function (tty) {
				if (tty.output && tty.output.length > 0) {
					Module["printErr"](UTF8ArrayToString(tty.output, 0));
					tty.output = [];
				}
			}
		}
	};
	var MEMFS = {
		ops_table: null,
		mount: function (mount) {
			return MEMFS.createNode(null, "/", 16384 | 511, 0);
		},
		createNode: function (parent, name, mode, dev) {
			if (FS.isBlkdev(mode) || FS.isFIFO(mode)) {
				throw new FS.ErrnoError(ERRNO_CODES.EPERM);
			}
			if (!MEMFS.ops_table) {
				MEMFS.ops_table = {
					dir: {
						node: {
							getattr: MEMFS.node_ops.getattr,
							setattr: MEMFS.node_ops.setattr,
							lookup: MEMFS.node_ops.lookup,
							mknod: MEMFS.node_ops.mknod,
							rename: MEMFS.node_ops.rename,
							unlink: MEMFS.node_ops.unlink,
							rmdir: MEMFS.node_ops.rmdir,
							readdir: MEMFS.node_ops.readdir,
							symlink: MEMFS.node_ops.symlink
						},
						stream: {
							llseek: MEMFS.stream_ops.llseek
						}
					},
					file: {
						node: {
							getattr: MEMFS.node_ops.getattr,
							setattr: MEMFS.node_ops.setattr
						},
						stream: {
							llseek: MEMFS.stream_ops.llseek,
							read: MEMFS.stream_ops.read,
							write: MEMFS.stream_ops.write,
							allocate: MEMFS.stream_ops.allocate,
							mmap: MEMFS.stream_ops.mmap,
							msync: MEMFS.stream_ops.msync
						}
					},
					link: {
						node: {
							getattr: MEMFS.node_ops.getattr,
							setattr: MEMFS.node_ops.setattr,
							readlink: MEMFS.node_ops.readlink
						},
						stream: {}
					},
					chrdev: {
						node: {
							getattr: MEMFS.node_ops.getattr,
							setattr: MEMFS.node_ops.setattr
						},
						stream: FS.chrdev_stream_ops
					}
				};
			}
			var node = FS.createNode(parent, name, mode, dev);
			if (FS.isDir(node.mode)) {
				node.node_ops = MEMFS.ops_table.dir.node;
				node.stream_ops = MEMFS.ops_table.dir.stream;
				node.contents = {};
			} else if (FS.isFile(node.mode)) {
				node.node_ops = MEMFS.ops_table.file.node;
				node.stream_ops = MEMFS.ops_table.file.stream;
				node.usedBytes = 0;
				node.contents = null;
			} else if (FS.isLink(node.mode)) {
				node.node_ops = MEMFS.ops_table.link.node;
				node.stream_ops = MEMFS.ops_table.link.stream;
			} else if (FS.isChrdev(node.mode)) {
				node.node_ops = MEMFS.ops_table.chrdev.node;
				node.stream_ops = MEMFS.ops_table.chrdev.stream;
			}
			node.timestamp = Date.now();
			if (parent) {
				parent.contents[name] = node;
			}
			return node;
		},
		getFileDataAsRegularArray: function (node) {
			if (node.contents && node.contents.subarray) {
				var arr = [];
				for (var i = 0; i < node.usedBytes; ++i) arr.push(node.contents[i]);
				return arr;
			}
			return node.contents;
		},
		getFileDataAsTypedArray: function (node) {
			if (!node.contents) return new Uint8Array();
			if (node.contents.subarray) return node.contents.subarray(0, node.usedBytes);
			return new Uint8Array(node.contents);
		},
		expandFileStorage: function (node, newCapacity) {
			if (node.contents && node.contents.subarray && newCapacity > node.contents.length) {
				node.contents = MEMFS.getFileDataAsRegularArray(node);
				node.usedBytes = node.contents.length;
			}
			if (!node.contents || node.contents.subarray) {
				var prevCapacity = node.contents ? node.contents.buffer.byteLength : 0;
				if (prevCapacity >= newCapacity) return;
				var CAPACITY_DOUBLING_MAX = 1024 * 1024;
				newCapacity = Math.max(newCapacity, prevCapacity * (prevCapacity < CAPACITY_DOUBLING_MAX ? 2 : 1.125) | 0);
				if (prevCapacity != 0) newCapacity = Math.max(newCapacity, 256);
				var oldContents = node.contents;
				node.contents = new Uint8Array(newCapacity);
				if (node.usedBytes > 0) node.contents.set(oldContents.subarray(0, node.usedBytes), 0);
				return;
			}
			if (!node.contents && newCapacity > 0) node.contents = [];
			while (node.contents.length < newCapacity) node.contents.push(0);
		},
		resizeFileStorage: function (node, newSize) {
			if (node.usedBytes == newSize) return;
			if (newSize == 0) {
				node.contents = null;
				node.usedBytes = 0;
				return;
			}
			if (!node.contents || node.contents.subarray) {
				var oldContents = node.contents;
				node.contents = new Uint8Array(new ArrayBuffer(newSize));
				if (oldContents) {
					node.contents.set(oldContents.subarray(0, Math.min(newSize, node.usedBytes)));
				}
				node.usedBytes = newSize;
				return;
			}
			if (!node.contents) node.contents = [];
			if (node.contents.length > newSize) node.contents.length = newSize; else while (node.contents.length < newSize) node.contents.push(0);
			node.usedBytes = newSize;
		},
		node_ops: {
			getattr: function (node) {
				var attr = {};
				attr.dev = FS.isChrdev(node.mode) ? node.id : 1;
				attr.ino = node.id;
				attr.mode = node.mode;
				attr.nlink = 1;
				attr.uid = 0;
				attr.gid = 0;
				attr.rdev = node.rdev;
				if (FS.isDir(node.mode)) {
					attr.size = 4096;
				} else if (FS.isFile(node.mode)) {
					attr.size = node.usedBytes;
				} else if (FS.isLink(node.mode)) {
					attr.size = node.link.length;
				} else {
					attr.size = 0;
				}
				attr.atime = new Date(node.timestamp);
				attr.mtime = new Date(node.timestamp);
				attr.ctime = new Date(node.timestamp);
				attr.blksize = 4096;
				attr.blocks = Math.ceil(attr.size / attr.blksize);
				return attr;
			},
			setattr: function (node, attr) {
				if (attr.mode !== undefined) {
					node.mode = attr.mode;
				}
				if (attr.timestamp !== undefined) {
					node.timestamp = attr.timestamp;
				}
				if (attr.size !== undefined) {
					MEMFS.resizeFileStorage(node, attr.size);
				}
			},
			lookup: function (parent, name) {
				throw FS.genericErrors[ERRNO_CODES.ENOENT];
			},
			mknod: function (parent, name, mode, dev) {
				return MEMFS.createNode(parent, name, mode, dev);
			},
			rename: function (old_node, new_dir, new_name) {
				if (FS.isDir(old_node.mode)) {
					var new_node;
					try {
						new_node = FS.lookupNode(new_dir, new_name);
					} catch (e) { }
					if (new_node) {
						for (var i in new_node.contents) {
							throw new FS.ErrnoError(ERRNO_CODES.ENOTEMPTY);
						}
					}
				}
				delete old_node.parent.contents[old_node.name];
				old_node.name = new_name;
				new_dir.contents[new_name] = old_node;
				old_node.parent = new_dir;
			},
			unlink: function (parent, name) {
				delete parent.contents[name];
			},
			rmdir: function (parent, name) {
				var node = FS.lookupNode(parent, name);
				for (var i in node.contents) {
					throw new FS.ErrnoError(ERRNO_CODES.ENOTEMPTY);
				}
				delete parent.contents[name];
			},
			readdir: function (node) {
				var entries = [".", ".."];
				for (var key in node.contents) {
					if (!node.contents.hasOwnProperty(key)) {
						continue;
					}
					entries.push(key);
				}
				return entries;
			},
			symlink: function (parent, newname, oldpath) {
				var node = MEMFS.createNode(parent, newname, 511 | 40960, 0);
				node.link = oldpath;
				return node;
			},
			readlink: function (node) {
				if (!FS.isLink(node.mode)) {
					throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
				}
				return node.link;
			}
		},
		stream_ops: {
			read: function (stream, buffer, offset, length, position) {
				var contents = stream.node.contents;
				if (position >= stream.node.usedBytes) return 0;
				var size = Math.min(stream.node.usedBytes - position, length);
				assert(size >= 0);
				if (size > 8 && contents.subarray) {
					buffer.set(contents.subarray(position, position + size), offset);
				} else {
					for (var i = 0; i < size; i++) buffer[offset + i] = contents[position + i];
				}
				return size;
			},
			write: function (stream, buffer, offset, length, position, canOwn) {
				if (!length) return 0;
				var node = stream.node;
				node.timestamp = Date.now();
				if (buffer.subarray && (!node.contents || node.contents.subarray)) {
					if (canOwn) {
						node.contents = buffer.subarray(offset, offset + length);
						node.usedBytes = length;
						return length;
					} else if (node.usedBytes === 0 && position === 0) {
						node.contents = new Uint8Array(buffer.subarray(offset, offset + length));
						node.usedBytes = length;
						return length;
					} else if (position + length <= node.usedBytes) {
						node.contents.set(buffer.subarray(offset, offset + length), position);
						return length;
					}
				}
				MEMFS.expandFileStorage(node, position + length);
				if (node.contents.subarray && buffer.subarray) node.contents.set(buffer.subarray(offset, offset + length), position); else {
					for (var i = 0; i < length; i++) {
						node.contents[position + i] = buffer[offset + i];
					}
				}
				node.usedBytes = Math.max(node.usedBytes, position + length);
				return length;
			},
			llseek: function (stream, offset, whence) {
				var position = offset;
				if (whence === 1) {
					position += stream.position;
				} else if (whence === 2) {
					if (FS.isFile(stream.node.mode)) {
						position += stream.node.usedBytes;
					}
				}
				if (position < 0) {
					throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
				}
				return position;
			},
			allocate: function (stream, offset, length) {
				MEMFS.expandFileStorage(stream.node, offset + length);
				stream.node.usedBytes = Math.max(stream.node.usedBytes, offset + length);
			},
			mmap: function (stream, buffer, offset, length, position, prot, flags) {
				if (!FS.isFile(stream.node.mode)) {
					throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
				}
				var ptr;
				var allocated;
				var contents = stream.node.contents;
				if (!(flags & 2) && (contents.buffer === buffer || contents.buffer === buffer.buffer)) {
					allocated = false;
					ptr = contents.byteOffset;
				} else {
					if (position > 0 || position + length < stream.node.usedBytes) {
						if (contents.subarray) {
							contents = contents.subarray(position, position + length);
						} else {
							contents = Array.prototype.slice.call(contents, position, position + length);
						}
					}
					allocated = true;
					ptr = _malloc(length);
					if (!ptr) {
						throw new FS.ErrnoError(ERRNO_CODES.ENOMEM);
					}
					buffer.set(contents, ptr);
				}
				return {
					ptr: ptr,
					allocated: allocated
				};
			},
			msync: function (stream, buffer, offset, length, mmapFlags) {
				if (!FS.isFile(stream.node.mode)) {
					throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
				}
				if (mmapFlags & 2) {
					return 0;
				}
				var bytesWritten = MEMFS.stream_ops.write(stream, buffer, 0, length, offset, false);
				return 0;
			}
		}
	};
	var IDBFS = {
		dbs: {},
		indexedDB: function () {
			if (typeof indexedDB !== "undefined") return indexedDB;
			var ret = null;
			if (typeof window === "object") ret = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
			assert(ret, "IDBFS used, but indexedDB not supported");
			return ret;
		},
		DB_VERSION: 21,
		DB_STORE_NAME: "FILE_DATA",
		mount: function (mount) {
			return MEMFS.mount.apply(null, arguments);
		},
		syncfs: function (mount, populate, callback) {
			IDBFS.getLocalSet(mount, function (err, local) {
				if (err) return callback(err);
				IDBFS.getRemoteSet(mount, function (err, remote) {
					if (err) return callback(err);
					var src = populate ? remote : local;
					var dst = populate ? local : remote;
					IDBFS.reconcile(src, dst, callback);
				});
			});
		},
		getDB: function (name, callback) {
			var db = IDBFS.dbs[name];
			if (db) {
				return callback(null, db);
			}
			var req;
			try {
				req = IDBFS.indexedDB().open(name, IDBFS.DB_VERSION);
			} catch (e) {
				return callback(e);
			}
			req.onupgradeneeded = function (e) {
				var db = e.target.result;
				var transaction = e.target.transaction;
				var fileStore;
				if (db.objectStoreNames.contains(IDBFS.DB_STORE_NAME)) {
					fileStore = transaction.objectStore(IDBFS.DB_STORE_NAME);
				} else {
					fileStore = db.createObjectStore(IDBFS.DB_STORE_NAME);
				}
				if (!fileStore.indexNames.contains("timestamp")) {
					fileStore.createIndex("timestamp", "timestamp", {
						unique: false
					});
				}
			};
			req.onsuccess = function () {
				db = req.result;
				IDBFS.dbs[name] = db;
				callback(null, db);
			};
			req.onerror = function (e) {
				callback(this.error);
				e.preventDefault();
			};
		},
		getLocalSet: function (mount, callback) {
			var entries = {};
			function isRealDir(p) {
				return p !== "." && p !== "..";
			}
			function toAbsolute(root) {
				return function (p) {
					return PATH.join2(root, p);
				};
			}
			var check = FS.readdir(mount.mountpoint).filter(isRealDir).map(toAbsolute(mount.mountpoint));
			while (check.length) {
				var path = check.pop();
				var stat;
				try {
					stat = FS.stat(path);
				} catch (e) {
					return callback(e);
				}
				if (FS.isDir(stat.mode)) {
					check.push.apply(check, FS.readdir(path).filter(isRealDir).map(toAbsolute(path)));
				}
				entries[path] = {
					timestamp: stat.mtime
				};
			}
			return callback(null, {
				type: "local",
				entries: entries
			});
		},
		getRemoteSet: function (mount, callback) {
			var entries = {};
			IDBFS.getDB(mount.mountpoint, function (err, db) {
				if (err) return callback(err);
				var transaction = db.transaction([IDBFS.DB_STORE_NAME], "readonly");
				transaction.onerror = function (e) {
					callback(this.error);
					e.preventDefault();
				};
				var store = transaction.objectStore(IDBFS.DB_STORE_NAME);
				var index = store.index("timestamp");
				index.openKeyCursor().onsuccess = function (event) {
					var cursor = event.target.result;
					if (!cursor) {
						return callback(null, {
							type: "remote",
							db: db,
							entries: entries
						});
					}
					entries[cursor.primaryKey] = {
						timestamp: cursor.key
					};
					cursor.continue();
				};
			});
		},
		loadLocalEntry: function (path, callback) {
			var stat, node;
			try {
				var lookup = FS.lookupPath(path);
				node = lookup.node;
				stat = FS.stat(path);
			} catch (e) {
				return callback(e);
			}
			if (FS.isDir(stat.mode)) {
				return callback(null, {
					timestamp: stat.mtime,
					mode: stat.mode
				});
			} else if (FS.isFile(stat.mode)) {
				node.contents = MEMFS.getFileDataAsTypedArray(node);
				return callback(null, {
					timestamp: stat.mtime,
					mode: stat.mode,
					contents: node.contents
				});
			} else {
				return callback(new Error("node type not supported"));
			}
		},
		storeLocalEntry: function (path, entry, callback) {
			try {
				if (FS.isDir(entry.mode)) {
					FS.mkdir(path, entry.mode);
				} else if (FS.isFile(entry.mode)) {
					FS.writeFile(path, entry.contents, {
						encoding: "binary",
						canOwn: true
					});
				} else {
					return callback(new Error("node type not supported"));
				}
				FS.chmod(path, entry.mode);
				FS.utime(path, entry.timestamp, entry.timestamp);
			} catch (e) {
				return callback(e);
			}
			callback(null);
		},
		removeLocalEntry: function (path, callback) {
			try {
				var lookup = FS.lookupPath(path);
				var stat = FS.stat(path);
				if (FS.isDir(stat.mode)) {
					FS.rmdir(path);
				} else if (FS.isFile(stat.mode)) {
					FS.unlink(path);
				}
			} catch (e) {
				return callback(e);
			}
			callback(null);
		},
		loadRemoteEntry: function (store, path, callback) {
			var req = store.get(path);
			req.onsuccess = function (event) {
				callback(null, event.target.result);
			};
			req.onerror = function (e) {
				callback(this.error);
				e.preventDefault();
			};
		},
		storeRemoteEntry: function (store, path, entry, callback) {
			var req = store.put(entry, path);
			req.onsuccess = function () {
				callback(null);
			};
			req.onerror = function (e) {
				callback(this.error);
				e.preventDefault();
			};
		},
		removeRemoteEntry: function (store, path, callback) {
			var req = store.delete(path);
			req.onsuccess = function () {
				callback(null);
			};
			req.onerror = function (e) {
				callback(this.error);
				e.preventDefault();
			};
		},
		reconcile: function (src, dst, callback) {
			var total = 0;
			var create = [];
			Object.keys(src.entries).forEach(function (key) {
				var e = src.entries[key];
				var e2 = dst.entries[key];
				if (!e2 || e.timestamp > e2.timestamp) {
					create.push(key);
					total++;
				}
			});
			var remove = [];
			Object.keys(dst.entries).forEach(function (key) {
				var e = dst.entries[key];
				var e2 = src.entries[key];
				if (!e2) {
					remove.push(key);
					total++;
				}
			});
			if (!total) {
				return callback(null);
			}
			var errored = false;
			var completed = 0;
			var db = src.type === "remote" ? src.db : dst.db;
			var transaction = db.transaction([IDBFS.DB_STORE_NAME], "readwrite");
			var store = transaction.objectStore(IDBFS.DB_STORE_NAME);
			function done(err) {
				if (err) {
					if (!done.errored) {
						done.errored = true;
						return callback(err);
					}
					return;
				}
				if (++completed >= total) {
					return callback(null);
				}
			}
			transaction.onerror = function (e) {
				done(this.error);
				e.preventDefault();
			};
			create.sort().forEach(function (path) {
				if (dst.type === "local") {
					IDBFS.loadRemoteEntry(store, path, function (err, entry) {
						if (err) return done(err);
						IDBFS.storeLocalEntry(path, entry, done);
					});
				} else {
					IDBFS.loadLocalEntry(path, function (err, entry) {
						if (err) return done(err);
						IDBFS.storeRemoteEntry(store, path, entry, done);
					});
				}
			});
			remove.sort().reverse().forEach(function (path) {
				if (dst.type === "local") {
					IDBFS.removeLocalEntry(path, done);
				} else {
					IDBFS.removeRemoteEntry(store, path, done);
				}
			});
		}
	};
	var NODEFS = {
		isWindows: false,
		staticInit: function () {
			NODEFS.isWindows = !!process.platform.match(/^win/);
		},
		mount: function (mount) {
			assert(ENVIRONMENT_IS_NODE);
			return NODEFS.createNode(null, "/", NODEFS.getMode(mount.opts.root), 0);
		},
		createNode: function (parent, name, mode, dev) {
			if (!FS.isDir(mode) && !FS.isFile(mode) && !FS.isLink(mode)) {
				throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
			}
			var node = FS.createNode(parent, name, mode);
			node.node_ops = NODEFS.node_ops;
			node.stream_ops = NODEFS.stream_ops;
			return node;
		},
		getMode: function (path) {
			var stat;
			try {
				stat = fs.lstatSync(path);
				if (NODEFS.isWindows) {
					stat.mode = stat.mode | (stat.mode & 146) >> 1;
				}
			} catch (e) {
				if (!e.code) throw e;
				throw new FS.ErrnoError(ERRNO_CODES[e.code]);
			}
			return stat.mode;
		},
		realPath: function (node) {
			var parts = [];
			while (node.parent !== node) {
				parts.push(node.name);
				node = node.parent;
			}
			parts.push(node.mount.opts.root);
			parts.reverse();
			return PATH.join.apply(null, parts);
		},
		flagsToPermissionStringMap: {
			0: "r",
			1: "r+",
			2: "r+",
			64: "r",
			65: "r+",
			66: "r+",
			129: "rx+",
			193: "rx+",
			514: "w+",
			577: "w",
			578: "w+",
			705: "wx",
			706: "wx+",
			1024: "a",
			1025: "a",
			1026: "a+",
			1089: "a",
			1090: "a+",
			1153: "ax",
			1154: "ax+",
			1217: "ax",
			1218: "ax+",
			4096: "rs",
			4098: "rs+"
		},
		flagsToPermissionString: function (flags) {
			if (flags in NODEFS.flagsToPermissionStringMap) {
				return NODEFS.flagsToPermissionStringMap[flags];
			} else {
				return flags;
			}
		},
		node_ops: {
			getattr: function (node) {
				var path = NODEFS.realPath(node);
				var stat;
				try {
					stat = fs.lstatSync(path);
				} catch (e) {
					if (!e.code) throw e;
					throw new FS.ErrnoError(ERRNO_CODES[e.code]);
				}
				if (NODEFS.isWindows && !stat.blksize) {
					stat.blksize = 4096;
				}
				if (NODEFS.isWindows && !stat.blocks) {
					stat.blocks = (stat.size + stat.blksize - 1) / stat.blksize | 0;
				}
				return {
					dev: stat.dev,
					ino: stat.ino,
					mode: stat.mode,
					nlink: stat.nlink,
					uid: stat.uid,
					gid: stat.gid,
					rdev: stat.rdev,
					size: stat.size,
					atime: stat.atime,
					mtime: stat.mtime,
					ctime: stat.ctime,
					blksize: stat.blksize,
					blocks: stat.blocks
				};
			},
			setattr: function (node, attr) {
				var path = NODEFS.realPath(node);
				try {
					if (attr.mode !== undefined) {
						fs.chmodSync(path, attr.mode);
						node.mode = attr.mode;
					}
					if (attr.timestamp !== undefined) {
						var date = new Date(attr.timestamp);
						fs.utimesSync(path, date, date);
					}
					if (attr.size !== undefined) {
						fs.truncateSync(path, attr.size);
					}
				} catch (e) {
					if (!e.code) throw e;
					throw new FS.ErrnoError(ERRNO_CODES[e.code]);
				}
			},
			lookup: function (parent, name) {
				var path = PATH.join2(NODEFS.realPath(parent), name);
				var mode = NODEFS.getMode(path);
				return NODEFS.createNode(parent, name, mode);
			},
			mknod: function (parent, name, mode, dev) {
				var node = NODEFS.createNode(parent, name, mode, dev);
				var path = NODEFS.realPath(node);
				try {
					if (FS.isDir(node.mode)) {
						fs.mkdirSync(path, node.mode);
					} else {
						fs.writeFileSync(path, "", {
							mode: node.mode
						});
					}
				} catch (e) {
					if (!e.code) throw e;
					throw new FS.ErrnoError(ERRNO_CODES[e.code]);
				}
				return node;
			},
			rename: function (oldNode, newDir, newName) {
				var oldPath = NODEFS.realPath(oldNode);
				var newPath = PATH.join2(NODEFS.realPath(newDir), newName);
				try {
					fs.renameSync(oldPath, newPath);
				} catch (e) {
					if (!e.code) throw e;
					throw new FS.ErrnoError(ERRNO_CODES[e.code]);
				}
			},
			unlink: function (parent, name) {
				var path = PATH.join2(NODEFS.realPath(parent), name);
				try {
					fs.unlinkSync(path);
				} catch (e) {
					if (!e.code) throw e;
					throw new FS.ErrnoError(ERRNO_CODES[e.code]);
				}
			},
			rmdir: function (parent, name) {
				var path = PATH.join2(NODEFS.realPath(parent), name);
				try {
					fs.rmdirSync(path);
				} catch (e) {
					if (!e.code) throw e;
					throw new FS.ErrnoError(ERRNO_CODES[e.code]);
				}
			},
			readdir: function (node) {
				var path = NODEFS.realPath(node);
				try {
					return fs.readdirSync(path);
				} catch (e) {
					if (!e.code) throw e;
					throw new FS.ErrnoError(ERRNO_CODES[e.code]);
				}
			},
			symlink: function (parent, newName, oldPath) {
				var newPath = PATH.join2(NODEFS.realPath(parent), newName);
				try {
					fs.symlinkSync(oldPath, newPath);
				} catch (e) {
					if (!e.code) throw e;
					throw new FS.ErrnoError(ERRNO_CODES[e.code]);
				}
			},
			readlink: function (node) {
				var path = NODEFS.realPath(node);
				try {
					path = fs.readlinkSync(path);
					path = NODEJS_PATH.relative(NODEJS_PATH.resolve(node.mount.opts.root), path);
					return path;
				} catch (e) {
					if (!e.code) throw e;
					throw new FS.ErrnoError(ERRNO_CODES[e.code]);
				}
			}
		},
		stream_ops: {
			open: function (stream) {
				var path = NODEFS.realPath(stream.node);
				try {
					if (FS.isFile(stream.node.mode)) {
						stream.nfd = fs.openSync(path, NODEFS.flagsToPermissionString(stream.flags));
					}
				} catch (e) {
					if (!e.code) throw e;
					throw new FS.ErrnoError(ERRNO_CODES[e.code]);
				}
			},
			close: function (stream) {
				try {
					if (FS.isFile(stream.node.mode) && stream.nfd) {
						fs.closeSync(stream.nfd);
					}
				} catch (e) {
					if (!e.code) throw e;
					throw new FS.ErrnoError(ERRNO_CODES[e.code]);
				}
			},
			read: function (stream, buffer, offset, length, position) {
				if (length === 0) return 0;
				var nbuffer = new Buffer(length);
				var res;
				try {
					res = fs.readSync(stream.nfd, nbuffer, 0, length, position);
				} catch (e) {
					throw new FS.ErrnoError(ERRNO_CODES[e.code]);
				}
				if (res > 0) {
					for (var i = 0; i < res; i++) {
						buffer[offset + i] = nbuffer[i];
					}
				}
				return res;
			},
			write: function (stream, buffer, offset, length, position) {
				var nbuffer = new Buffer(buffer.subarray(offset, offset + length));
				var res;
				try {
					res = fs.writeSync(stream.nfd, nbuffer, 0, length, position);
				} catch (e) {
					throw new FS.ErrnoError(ERRNO_CODES[e.code]);
				}
				return res;
			},
			llseek: function (stream, offset, whence) {
				var position = offset;
				if (whence === 1) {
					position += stream.position;
				} else if (whence === 2) {
					if (FS.isFile(stream.node.mode)) {
						try {
							var stat = fs.fstatSync(stream.nfd);
							position += stat.size;
						} catch (e) {
							throw new FS.ErrnoError(ERRNO_CODES[e.code]);
						}
					}
				}
				if (position < 0) {
					throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
				}
				return position;
			}
		}
	};
	var _stdin = allocate(1, "i32*", ALLOC_STATIC);
	var _stdout = allocate(1, "i32*", ALLOC_STATIC);
	var _stderr = allocate(1, "i32*", ALLOC_STATIC);
	function _fflush(stream) { }
	var FS = {
		root: null,
		mounts: [],
		devices: [null],
		streams: [],
		nextInode: 1,
		nameTable: null,
		currentPath: "/",
		initialized: false,
		ignorePermissions: true,
		trackingDelegate: {},
		tracking: {
			openFlags: {
				READ: 1,
				WRITE: 2
			}
		},
		ErrnoError: null,
		genericErrors: {},
		handleFSError: function (e) {
			if (!(e instanceof FS.ErrnoError)) throw e + " : " + stackTrace();
			return ___setErrNo(e.errno);
		},
		lookupPath: function (path, opts) {
			path = PATH.resolve(FS.cwd(), path);
			opts = opts || {};
			if (!path) return {
				path: "",
				node: null
			};
			var defaults = {
				follow_mount: true,
				recurse_count: 0
			};
			for (var key in defaults) {
				if (opts[key] === undefined) {
					opts[key] = defaults[key];
				}
			}
			if (opts.recurse_count > 8) {
				throw new FS.ErrnoError(ERRNO_CODES.ELOOP);
			}
			var parts = PATH.normalizeArray(path.split("/").filter(function (p) {
				return !!p;
			}), false);
			var current = FS.root;
			var current_path = "/";
			for (var i = 0; i < parts.length; i++) {
				var islast = i === parts.length - 1;
				if (islast && opts.parent) {
					break;
				}
				current = FS.lookupNode(current, parts[i]);
				current_path = PATH.join2(current_path, parts[i]);
				if (FS.isMountpoint(current)) {
					if (!islast || islast && opts.follow_mount) {
						current = current.mounted.root;
					}
				}
				if (!islast || opts.follow) {
					var count = 0;
					while (FS.isLink(current.mode)) {
						var link = FS.readlink(current_path);
						current_path = PATH.resolve(PATH.dirname(current_path), link);
						var lookup = FS.lookupPath(current_path, {
							recurse_count: opts.recurse_count
						});
						current = lookup.node;
						if (count++ > 40) {
							throw new FS.ErrnoError(ERRNO_CODES.ELOOP);
						}
					}
				}
			}
			return {
				path: current_path,
				node: current
			};
		},
		getPath: function (node) {
			var path;
			while (true) {
				if (FS.isRoot(node)) {
					var mount = node.mount.mountpoint;
					if (!path) return mount;
					return mount[mount.length - 1] !== "/" ? mount + "/" + path : mount + path;
				}
				path = path ? node.name + "/" + path : node.name;
				node = node.parent;
			}
		},
		hashName: function (parentid, name) {
			var hash = 0;
			for (var i = 0; i < name.length; i++) {
				hash = (hash << 5) - hash + name.charCodeAt(i) | 0;
			}
			return (parentid + hash >>> 0) % FS.nameTable.length;
		},
		hashAddNode: function (node) {
			var hash = FS.hashName(node.parent.id, node.name);
			node.name_next = FS.nameTable[hash];
			FS.nameTable[hash] = node;
		},
		hashRemoveNode: function (node) {
			var hash = FS.hashName(node.parent.id, node.name);
			if (FS.nameTable[hash] === node) {
				FS.nameTable[hash] = node.name_next;
			} else {
				var current = FS.nameTable[hash];
				while (current) {
					if (current.name_next === node) {
						current.name_next = node.name_next;
						break;
					}
					current = current.name_next;
				}
			}
		},
		lookupNode: function (parent, name) {
			var err = FS.mayLookup(parent);
			if (err) {
				throw new FS.ErrnoError(err, parent);
			}
			var hash = FS.hashName(parent.id, name);
			for (var node = FS.nameTable[hash]; node; node = node.name_next) {
				var nodeName = node.name;
				if (node.parent.id === parent.id && nodeName === name) {
					return node;
				}
			}
			return FS.lookup(parent, name);
		},
		createNode: function (parent, name, mode, rdev) {
			if (!FS.FSNode) {
				FS.FSNode = function (parent, name, mode, rdev) {
					if (!parent) {
						parent = this;
					}
					this.parent = parent;
					this.mount = parent.mount;
					this.mounted = null;
					this.id = FS.nextInode++;
					this.name = name;
					this.mode = mode;
					this.node_ops = {};
					this.stream_ops = {};
					this.rdev = rdev;
				};
				FS.FSNode.prototype = {};
				var readMode = 292 | 73;
				var writeMode = 146;
				Object.defineProperties(FS.FSNode.prototype, {
					read: {
						get: function () {
							return (this.mode & readMode) === readMode;
						},
						set: function (val) {
							val ? this.mode |= readMode : this.mode &= ~readMode;
						}
					},
					write: {
						get: function () {
							return (this.mode & writeMode) === writeMode;
						},
						set: function (val) {
							val ? this.mode |= writeMode : this.mode &= ~writeMode;
						}
					},
					isFolder: {
						get: function () {
							return FS.isDir(this.mode);
						}
					},
					isDevice: {
						get: function () {
							return FS.isChrdev(this.mode);
						}
					}
				});
			}
			var node = new FS.FSNode(parent, name, mode, rdev);
			FS.hashAddNode(node);
			return node;
		},
		destroyNode: function (node) {
			FS.hashRemoveNode(node);
		},
		isRoot: function (node) {
			return node === node.parent;
		},
		isMountpoint: function (node) {
			return !!node.mounted;
		},
		isFile: function (mode) {
			return (mode & 61440) === 32768;
		},
		isDir: function (mode) {
			return (mode & 61440) === 16384;
		},
		isLink: function (mode) {
			return (mode & 61440) === 40960;
		},
		isChrdev: function (mode) {
			return (mode & 61440) === 8192;
		},
		isBlkdev: function (mode) {
			return (mode & 61440) === 24576;
		},
		isFIFO: function (mode) {
			return (mode & 61440) === 4096;
		},
		isSocket: function (mode) {
			return (mode & 49152) === 49152;
		},
		flagModes: {
			r: 0,
			rs: 1052672,
			"r+": 2,
			w: 577,
			wx: 705,
			xw: 705,
			"w+": 578,
			"wx+": 706,
			"xw+": 706,
			a: 1089,
			ax: 1217,
			xa: 1217,
			"a+": 1090,
			"ax+": 1218,
			"xa+": 1218
		},
		modeStringToFlags: function (str) {
			var flags = FS.flagModes[str];
			if (typeof flags === "undefined") {
				throw new Error("Unknown file open mode: " + str);
			}
			return flags;
		},
		flagsToPermissionString: function (flag) {
			var accmode = flag & 2097155;
			var perms = ["r", "w", "rw"][accmode];
			if (flag & 512) {
				perms += "w";
			}
			return perms;
		},
		nodePermissions: function (node, perms) {
			if (FS.ignorePermissions) {
				return 0;
			}
			if (perms.indexOf("r") !== -1 && !(node.mode & 292)) {
				return ERRNO_CODES.EACCES;
			} else if (perms.indexOf("w") !== -1 && !(node.mode & 146)) {
				return ERRNO_CODES.EACCES;
			} else if (perms.indexOf("x") !== -1 && !(node.mode & 73)) {
				return ERRNO_CODES.EACCES;
			}
			return 0;
		},
		mayLookup: function (dir) {
			var err = FS.nodePermissions(dir, "x");
			if (err) return err;
			if (!dir.node_ops.lookup) return ERRNO_CODES.EACCES;
			return 0;
		},
		mayCreate: function (dir, name) {
			try {
				var node = FS.lookupNode(dir, name);
				return ERRNO_CODES.EEXIST;
			} catch (e) { }
			return FS.nodePermissions(dir, "wx");
		},
		mayDelete: function (dir, name, isdir) {
			var node;
			try {
				node = FS.lookupNode(dir, name);
			} catch (e) {
				return e.errno;
			}
			var err = FS.nodePermissions(dir, "wx");
			if (err) {
				return err;
			}
			if (isdir) {
				if (!FS.isDir(node.mode)) {
					return ERRNO_CODES.ENOTDIR;
				}
				if (FS.isRoot(node) || FS.getPath(node) === FS.cwd()) {
					return ERRNO_CODES.EBUSY;
				}
			} else {
				if (FS.isDir(node.mode)) {
					return ERRNO_CODES.EISDIR;
				}
			}
			return 0;
		},
		mayOpen: function (node, flags) {
			if (!node) {
				return ERRNO_CODES.ENOENT;
			}
			if (FS.isLink(node.mode)) {
				return ERRNO_CODES.ELOOP;
			} else if (FS.isDir(node.mode)) {
				if ((flags & 2097155) !== 0 || flags & 512) {
					return ERRNO_CODES.EISDIR;
				}
			}
			return FS.nodePermissions(node, FS.flagsToPermissionString(flags));
		},
		MAX_OPEN_FDS: 4096,
		nextfd: function (fd_start, fd_end) {
			fd_start = fd_start || 0;
			fd_end = fd_end || FS.MAX_OPEN_FDS;
			for (var fd = fd_start; fd <= fd_end; fd++) {
				if (!FS.streams[fd]) {
					return fd;
				}
			}
			throw new FS.ErrnoError(ERRNO_CODES.EMFILE);
		},
		getStream: function (fd) {
			return FS.streams[fd];
		},
		createStream: function (stream, fd_start, fd_end) {
			if (!FS.FSStream) {
				FS.FSStream = function () { };
				FS.FSStream.prototype = {};
				Object.defineProperties(FS.FSStream.prototype, {
					object: {
						get: function () {
							return this.node;
						},
						set: function (val) {
							this.node = val;
						}
					},
					isRead: {
						get: function () {
							return (this.flags & 2097155) !== 1;
						}
					},
					isWrite: {
						get: function () {
							return (this.flags & 2097155) !== 0;
						}
					},
					isAppend: {
						get: function () {
							return this.flags & 1024;
						}
					}
				});
			}
			var newStream = new FS.FSStream();
			for (var p in stream) {
				newStream[p] = stream[p];
			}
			stream = newStream;
			var fd = FS.nextfd(fd_start, fd_end);
			stream.fd = fd;
			FS.streams[fd] = stream;
			return stream;
		},
		closeStream: function (fd) {
			FS.streams[fd] = null;
		},
		getStreamFromPtr: function (ptr) {
			return FS.streams[ptr - 1];
		},
		getPtrForStream: function (stream) {
			return stream ? stream.fd + 1 : 0;
		},
		chrdev_stream_ops: {
			open: function (stream) {
				var device = FS.getDevice(stream.node.rdev);
				stream.stream_ops = device.stream_ops;
				if (stream.stream_ops.open) {
					stream.stream_ops.open(stream);
				}
			},
			llseek: function () {
				throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
			}
		},
		major: function (dev) {
			return dev >> 8;
		},
		minor: function (dev) {
			return dev & 255;
		},
		makedev: function (ma, mi) {
			return ma << 8 | mi;
		},
		registerDevice: function (dev, ops) {
			FS.devices[dev] = {
				stream_ops: ops
			};
		},
		getDevice: function (dev) {
			return FS.devices[dev];
		},
		getMounts: function (mount) {
			var mounts = [];
			var check = [mount];
			while (check.length) {
				var m = check.pop();
				mounts.push(m);
				check.push.apply(check, m.mounts);
			}
			return mounts;
		},
		syncfs: function (populate, callback) {
			if (typeof populate === "function") {
				callback = populate;
				populate = false;
			}
			var mounts = FS.getMounts(FS.root.mount);
			var completed = 0;
			function done(err) {
				if (err) {
					if (!done.errored) {
						done.errored = true;
						return callback(err);
					}
					return;
				}
				if (++completed >= mounts.length) {
					callback(null);
				}
			}
			mounts.forEach(function (mount) {
				if (!mount.type.syncfs) {
					return done(null);
				}
				mount.type.syncfs(mount, populate, done);
			});
		},
		mount: function (type, opts, mountpoint) {
			var root = mountpoint === "/";
			var pseudo = !mountpoint;
			var node;
			if (root && FS.root) {
				throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
			} else if (!root && !pseudo) {
				var lookup = FS.lookupPath(mountpoint, {
					follow_mount: false
				});
				mountpoint = lookup.path;
				node = lookup.node;
				if (FS.isMountpoint(node)) {
					throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
				}
				if (!FS.isDir(node.mode)) {
					throw new FS.ErrnoError(ERRNO_CODES.ENOTDIR);
				}
			}
			var mount = {
				type: type,
				opts: opts,
				mountpoint: mountpoint,
				mounts: []
			};
			var mountRoot = type.mount(mount);
			mountRoot.mount = mount;
			mount.root = mountRoot;
			if (root) {
				FS.root = mountRoot;
			} else if (node) {
				node.mounted = mount;
				if (node.mount) {
					node.mount.mounts.push(mount);
				}
			}
			return mountRoot;
		},
		unmount: function (mountpoint) {
			var lookup = FS.lookupPath(mountpoint, {
				follow_mount: false
			});
			if (!FS.isMountpoint(lookup.node)) {
				throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
			}
			var node = lookup.node;
			var mount = node.mounted;
			var mounts = FS.getMounts(mount);
			Object.keys(FS.nameTable).forEach(function (hash) {
				var current = FS.nameTable[hash];
				while (current) {
					var next = current.name_next;
					if (mounts.indexOf(current.mount) !== -1) {
						FS.destroyNode(current);
					}
					current = next;
				}
			});
			node.mounted = null;
			var idx = node.mount.mounts.indexOf(mount);
			assert(idx !== -1);
			node.mount.mounts.splice(idx, 1);
		},
		lookup: function (parent, name) {
			return parent.node_ops.lookup(parent, name);
		},
		mknod: function (path, mode, dev) {
			var lookup = FS.lookupPath(path, {
				parent: true
			});
			var parent = lookup.node;
			var name = PATH.basename(path);
			if (!name || name === "." || name === "..") {
				throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
			}
			var err = FS.mayCreate(parent, name);
			if (err) {
				throw new FS.ErrnoError(err);
			}
			if (!parent.node_ops.mknod) {
				throw new FS.ErrnoError(ERRNO_CODES.EPERM);
			}
			return parent.node_ops.mknod(parent, name, mode, dev);
		},
		create: function (path, mode) {
			mode = mode !== undefined ? mode : 438;
			mode &= 4095;
			mode |= 32768;
			return FS.mknod(path, mode, 0);
		},
		mkdir: function (path, mode) {
			mode = mode !== undefined ? mode : 511;
			mode &= 511 | 512;
			mode |= 16384;
			return FS.mknod(path, mode, 0);
		},
		mkdev: function (path, mode, dev) {
			if (typeof dev === "undefined") {
				dev = mode;
				mode = 438;
			}
			mode |= 8192;
			return FS.mknod(path, mode, dev);
		},
		symlink: function (oldpath, newpath) {
			if (!PATH.resolve(oldpath)) {
				throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
			}
			var lookup = FS.lookupPath(newpath, {
				parent: true
			});
			var parent = lookup.node;
			if (!parent) {
				throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
			}
			var newname = PATH.basename(newpath);
			var err = FS.mayCreate(parent, newname);
			if (err) {
				throw new FS.ErrnoError(err);
			}
			if (!parent.node_ops.symlink) {
				throw new FS.ErrnoError(ERRNO_CODES.EPERM);
			}
			return parent.node_ops.symlink(parent, newname, oldpath);
		},
		rename: function (old_path, new_path) {
			var old_dirname = PATH.dirname(old_path);
			var new_dirname = PATH.dirname(new_path);
			var old_name = PATH.basename(old_path);
			var new_name = PATH.basename(new_path);
			var lookup, old_dir, new_dir;
			try {
				lookup = FS.lookupPath(old_path, {
					parent: true
				});
				old_dir = lookup.node;
				lookup = FS.lookupPath(new_path, {
					parent: true
				});
				new_dir = lookup.node;
			} catch (e) {
				throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
			}
			if (!old_dir || !new_dir) throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
			if (old_dir.mount !== new_dir.mount) {
				throw new FS.ErrnoError(ERRNO_CODES.EXDEV);
			}
			var old_node = FS.lookupNode(old_dir, old_name);
			var relative = PATH.relative(old_path, new_dirname);
			if (relative.charAt(0) !== ".") {
				throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
			}
			relative = PATH.relative(new_path, old_dirname);
			if (relative.charAt(0) !== ".") {
				throw new FS.ErrnoError(ERRNO_CODES.ENOTEMPTY);
			}
			var new_node;
			try {
				new_node = FS.lookupNode(new_dir, new_name);
			} catch (e) { }
			if (old_node === new_node) {
				return;
			}
			var isdir = FS.isDir(old_node.mode);
			var err = FS.mayDelete(old_dir, old_name, isdir);
			if (err) {
				throw new FS.ErrnoError(err);
			}
			err = new_node ? FS.mayDelete(new_dir, new_name, isdir) : FS.mayCreate(new_dir, new_name);
			if (err) {
				throw new FS.ErrnoError(err);
			}
			if (!old_dir.node_ops.rename) {
				throw new FS.ErrnoError(ERRNO_CODES.EPERM);
			}
			if (FS.isMountpoint(old_node) || new_node && FS.isMountpoint(new_node)) {
				throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
			}
			if (new_dir !== old_dir) {
				err = FS.nodePermissions(old_dir, "w");
				if (err) {
					throw new FS.ErrnoError(err);
				}
			}
			try {
				if (FS.trackingDelegate["willMovePath"]) {
					FS.trackingDelegate["willMovePath"](old_path, new_path);
				}
			} catch (e) {
				console.log("FS.trackingDelegate['willMovePath']('" + old_path + "', '" + new_path + "') threw an exception: " + e.message);
			}
			FS.hashRemoveNode(old_node);
			try {
				old_dir.node_ops.rename(old_node, new_dir, new_name);
			} catch (e) {
				throw e;
			} finally {
				FS.hashAddNode(old_node);
			}
			try {
				if (FS.trackingDelegate["onMovePath"]) FS.trackingDelegate["onMovePath"](old_path, new_path);
			} catch (e) {
				console.log("FS.trackingDelegate['onMovePath']('" + old_path + "', '" + new_path + "') threw an exception: " + e.message);
			}
		},
		rmdir: function (path) {
			var lookup = FS.lookupPath(path, {
				parent: true
			});
			var parent = lookup.node;
			var name = PATH.basename(path);
			var node = FS.lookupNode(parent, name);
			var err = FS.mayDelete(parent, name, true);
			if (err) {
				throw new FS.ErrnoError(err);
			}
			if (!parent.node_ops.rmdir) {
				throw new FS.ErrnoError(ERRNO_CODES.EPERM);
			}
			if (FS.isMountpoint(node)) {
				throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
			}
			try {
				if (FS.trackingDelegate["willDeletePath"]) {
					FS.trackingDelegate["willDeletePath"](path);
				}
			} catch (e) {
				console.log("FS.trackingDelegate['willDeletePath']('" + path + "') threw an exception: " + e.message);
			}
			parent.node_ops.rmdir(parent, name);
			FS.destroyNode(node);
			try {
				if (FS.trackingDelegate["onDeletePath"]) FS.trackingDelegate["onDeletePath"](path);
			} catch (e) {
				console.log("FS.trackingDelegate['onDeletePath']('" + path + "') threw an exception: " + e.message);
			}
		},
		readdir: function (path) {
			var lookup = FS.lookupPath(path, {
				follow: true
			});
			var node = lookup.node;
			if (!node.node_ops.readdir) {
				throw new FS.ErrnoError(ERRNO_CODES.ENOTDIR);
			}
			return node.node_ops.readdir(node);
		},
		unlink: function (path) {
			var lookup = FS.lookupPath(path, {
				parent: true
			});
			var parent = lookup.node;
			var name = PATH.basename(path);
			var node = FS.lookupNode(parent, name);
			var err = FS.mayDelete(parent, name, false);
			if (err) {
				if (err === ERRNO_CODES.EISDIR) err = ERRNO_CODES.EPERM;
				throw new FS.ErrnoError(err);
			}
			if (!parent.node_ops.unlink) {
				throw new FS.ErrnoError(ERRNO_CODES.EPERM);
			}
			if (FS.isMountpoint(node)) {
				throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
			}
			try {
				if (FS.trackingDelegate["willDeletePath"]) {
					FS.trackingDelegate["willDeletePath"](path);
				}
			} catch (e) {
				console.log("FS.trackingDelegate['willDeletePath']('" + path + "') threw an exception: " + e.message);
			}
			parent.node_ops.unlink(parent, name);
			FS.destroyNode(node);
			try {
				if (FS.trackingDelegate["onDeletePath"]) FS.trackingDelegate["onDeletePath"](path);
			} catch (e) {
				console.log("FS.trackingDelegate['onDeletePath']('" + path + "') threw an exception: " + e.message);
			}
		},
		readlink: function (path) {
			var lookup = FS.lookupPath(path);
			var link = lookup.node;
			if (!link) {
				throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
			}
			if (!link.node_ops.readlink) {
				throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
			}
			return PATH.resolve(FS.getPath(lookup.node.parent), link.node_ops.readlink(link));
		},
		stat: function (path, dontFollow) {
			var lookup = FS.lookupPath(path, {
				follow: !dontFollow
			});
			var node = lookup.node;
			if (!node) {
				throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
			}
			if (!node.node_ops.getattr) {
				throw new FS.ErrnoError(ERRNO_CODES.EPERM);
			}
			return node.node_ops.getattr(node);
		},
		lstat: function (path) {
			return FS.stat(path, true);
		},
		chmod: function (path, mode, dontFollow) {
			var node;
			if (typeof path === "string") {
				var lookup = FS.lookupPath(path, {
					follow: !dontFollow
				});
				node = lookup.node;
			} else {
				node = path;
			}
			if (!node.node_ops.setattr) {
				throw new FS.ErrnoError(ERRNO_CODES.EPERM);
			}
			node.node_ops.setattr(node, {
				mode: mode & 4095 | node.mode & ~4095,
				timestamp: Date.now()
			});
		},
		lchmod: function (path, mode) {
			FS.chmod(path, mode, true);
		},
		fchmod: function (fd, mode) {
			var stream = FS.getStream(fd);
			if (!stream) {
				throw new FS.ErrnoError(ERRNO_CODES.EBADF);
			}
			FS.chmod(stream.node, mode);
		},
		chown: function (path, uid, gid, dontFollow) {
			var node;
			if (typeof path === "string") {
				var lookup = FS.lookupPath(path, {
					follow: !dontFollow
				});
				node = lookup.node;
			} else {
				node = path;
			}
			if (!node.node_ops.setattr) {
				throw new FS.ErrnoError(ERRNO_CODES.EPERM);
			}
			node.node_ops.setattr(node, {
				timestamp: Date.now()
			});
		},
		lchown: function (path, uid, gid) {
			FS.chown(path, uid, gid, true);
		},
		fchown: function (fd, uid, gid) {
			var stream = FS.getStream(fd);
			if (!stream) {
				throw new FS.ErrnoError(ERRNO_CODES.EBADF);
			}
			FS.chown(stream.node, uid, gid);
		},
		truncate: function (path, len) {
			if (len < 0) {
				throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
			}
			var node;
			if (typeof path === "string") {
				var lookup = FS.lookupPath(path, {
					follow: true
				});
				node = lookup.node;
			} else {
				node = path;
			}
			if (!node.node_ops.setattr) {
				throw new FS.ErrnoError(ERRNO_CODES.EPERM);
			}
			if (FS.isDir(node.mode)) {
				throw new FS.ErrnoError(ERRNO_CODES.EISDIR);
			}
			if (!FS.isFile(node.mode)) {
				throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
			}
			var err = FS.nodePermissions(node, "w");
			if (err) {
				throw new FS.ErrnoError(err);
			}
			node.node_ops.setattr(node, {
				size: len,
				timestamp: Date.now()
			});
		},
		ftruncate: function (fd, len) {
			var stream = FS.getStream(fd);
			if (!stream) {
				throw new FS.ErrnoError(ERRNO_CODES.EBADF);
			}
			if ((stream.flags & 2097155) === 0) {
				throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
			}
			FS.truncate(stream.node, len);
		},
		utime: function (path, atime, mtime) {
			var lookup = FS.lookupPath(path, {
				follow: true
			});
			var node = lookup.node;
			node.node_ops.setattr(node, {
				timestamp: Math.max(atime, mtime)
			});
		},
		open: function (path, flags, mode, fd_start, fd_end) {
			if (path === "") {
				throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
			}
			flags = typeof flags === "string" ? FS.modeStringToFlags(flags) : flags;
			mode = typeof mode === "undefined" ? 438 : mode;
			if (flags & 64) {
				mode = mode & 4095 | 32768;
			} else {
				mode = 0;
			}
			var node;
			if (typeof path === "object") {
				node = path;
			} else {
				path = PATH.normalize(path);
				try {
					var lookup = FS.lookupPath(path, {
						follow: !(flags & 131072)
					});
					node = lookup.node;
				} catch (e) { }
			}
			var created = false;
			if (flags & 64) {
				if (node) {
					if (flags & 128) {
						throw new FS.ErrnoError(ERRNO_CODES.EEXIST);
					}
				} else {
					node = FS.mknod(path, mode, 0);
					created = true;
				}
			}
			if (!node) {
				throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
			}
			if (FS.isChrdev(node.mode)) {
				flags &= ~512;
			}
			if (!created) {
				var err = FS.mayOpen(node, flags);
				if (err) {
					throw new FS.ErrnoError(err);
				}
			}
			if (flags & 512) {
				FS.truncate(node, 0);
			}
			flags &= ~(128 | 512);
			var stream = FS.createStream({
				node: node,
				path: FS.getPath(node),
				flags: flags,
				seekable: true,
				position: 0,
				stream_ops: node.stream_ops,
				ungotten: [],
				error: false
			}, fd_start, fd_end);
			if (stream.stream_ops.open) {
				stream.stream_ops.open(stream);
			}
			if (Module["logReadFiles"] && !(flags & 1)) {
				if (!FS.readFiles) FS.readFiles = {};
				if (!(path in FS.readFiles)) {
					FS.readFiles[path] = 1;
					Module["printErr"]("read file: " + path);
				}
			}
			try {
				if (FS.trackingDelegate["onOpenFile"]) {
					var trackingFlags = 0;
					if ((flags & 2097155) !== 1) {
						trackingFlags |= FS.tracking.openFlags.READ;
					}
					if ((flags & 2097155) !== 0) {
						trackingFlags |= FS.tracking.openFlags.WRITE;
					}
					FS.trackingDelegate["onOpenFile"](path, trackingFlags);
				}
			} catch (e) {
				console.log("FS.trackingDelegate['onOpenFile']('" + path + "', flags) threw an exception: " + e.message);
			}
			return stream;
		},
		close: function (stream) {
			try {
				if (stream.stream_ops.close) {
					stream.stream_ops.close(stream);
				}
			} catch (e) {
				throw e;
			} finally {
				FS.closeStream(stream.fd);
			}
		},
		llseek: function (stream, offset, whence) {
			if (!stream.seekable || !stream.stream_ops.llseek) {
				throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
			}
			stream.position = stream.stream_ops.llseek(stream, offset, whence);
			stream.ungotten = [];
			return stream.position;
		},
		read: function (stream, buffer, offset, length, position) {
			if (length < 0 || position < 0) {
				throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
			}
			if ((stream.flags & 2097155) === 1) {
				throw new FS.ErrnoError(ERRNO_CODES.EBADF);
			}
			if (FS.isDir(stream.node.mode)) {
				throw new FS.ErrnoError(ERRNO_CODES.EISDIR);
			}
			if (!stream.stream_ops.read) {
				throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
			}
			var seeking = true;
			if (typeof position === "undefined") {
				position = stream.position;
				seeking = false;
			} else if (!stream.seekable) {
				throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
			}
			var bytesRead = stream.stream_ops.read(stream, buffer, offset, length, position);
			if (!seeking) stream.position += bytesRead;
			return bytesRead;
		},
		write: function (stream, buffer, offset, length, position, canOwn) {
			if (length < 0 || position < 0) {
				throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
			}
			if ((stream.flags & 2097155) === 0) {
				throw new FS.ErrnoError(ERRNO_CODES.EBADF);
			}
			if (FS.isDir(stream.node.mode)) {
				throw new FS.ErrnoError(ERRNO_CODES.EISDIR);
			}
			if (!stream.stream_ops.write) {
				throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
			}
			if (stream.flags & 1024) {
				FS.llseek(stream, 0, 2);
			}
			var seeking = true;
			if (typeof position === "undefined") {
				position = stream.position;
				seeking = false;
			} else if (!stream.seekable) {
				throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
			}
			var bytesWritten = stream.stream_ops.write(stream, buffer, offset, length, position, canOwn);
			if (!seeking) stream.position += bytesWritten;
			try {
				if (stream.path && FS.trackingDelegate["onWriteToFile"]) FS.trackingDelegate["onWriteToFile"](stream.path);
			} catch (e) {
				console.log("FS.trackingDelegate['onWriteToFile']('" + path + "') threw an exception: " + e.message);
			}
			return bytesWritten;
		},
		allocate: function (stream, offset, length) {
			if (offset < 0 || length <= 0) {
				throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
			}
			if ((stream.flags & 2097155) === 0) {
				throw new FS.ErrnoError(ERRNO_CODES.EBADF);
			}
			if (!FS.isFile(stream.node.mode) && !FS.isDir(node.mode)) {
				throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
			}
			if (!stream.stream_ops.allocate) {
				throw new FS.ErrnoError(ERRNO_CODES.EOPNOTSUPP);
			}
			stream.stream_ops.allocate(stream, offset, length);
		},
		mmap: function (stream, buffer, offset, length, position, prot, flags) {
			if ((stream.flags & 2097155) === 1) {
				throw new FS.ErrnoError(ERRNO_CODES.EACCES);
			}
			if (!stream.stream_ops.mmap) {
				throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
			}
			return stream.stream_ops.mmap(stream, buffer, offset, length, position, prot, flags);
		},
		msync: function (stream, buffer, offset, length, mmapFlags) {
			if (!stream || !stream.stream_ops.msync) {
				return 0;
			}
			return stream.stream_ops.msync(stream, buffer, offset, length, mmapFlags);
		},
		munmap: function (stream) {
			return 0;
		},
		ioctl: function (stream, cmd, arg) {
			if (!stream.stream_ops.ioctl) {
				throw new FS.ErrnoError(ERRNO_CODES.ENOTTY);
			}
			return stream.stream_ops.ioctl(stream, cmd, arg);
		},
		readFile: function (path, opts) {
			opts = opts || {};
			opts.flags = opts.flags || "r";
			opts.encoding = opts.encoding || "binary";
			if (opts.encoding !== "utf8" && opts.encoding !== "binary") {
				throw new Error('Invalid encoding type "' + opts.encoding + '"');
			}
			var ret;
			var stream = FS.open(path, opts.flags);
			var stat = FS.stat(path);
			var length = stat.size;
			var buf = new Uint8Array(length);
			FS.read(stream, buf, 0, length, 0);
			if (opts.encoding === "utf8") {
				ret = UTF8ArrayToString(buf, 0);
			} else if (opts.encoding === "binary") {
				ret = buf;
			}
			FS.close(stream);
			return ret;
		},
		writeFile: function (path, data, opts) {
			opts = opts || {};
			opts.flags = opts.flags || "w";
			opts.encoding = opts.encoding || "utf8";
			if (opts.encoding !== "utf8" && opts.encoding !== "binary") {
				throw new Error('Invalid encoding type "' + opts.encoding + '"');
			}
			var stream = FS.open(path, opts.flags, opts.mode);
			if (opts.encoding === "utf8") {
				var buf = new Uint8Array(lengthBytesUTF8(data) + 1);
				var actualNumBytes = stringToUTF8Array(data, buf, 0, buf.length);
				FS.write(stream, buf, 0, actualNumBytes, 0, opts.canOwn);
			} else if (opts.encoding === "binary") {
				FS.write(stream, data, 0, data.length, 0, opts.canOwn);
			}
			FS.close(stream);
		},
		cwd: function () {
			return FS.currentPath;
		},
		chdir: function (path) {
			var lookup = FS.lookupPath(path, {
				follow: true
			});
			if (!FS.isDir(lookup.node.mode)) {
				throw new FS.ErrnoError(ERRNO_CODES.ENOTDIR);
			}
			var err = FS.nodePermissions(lookup.node, "x");
			if (err) {
				throw new FS.ErrnoError(err);
			}
			FS.currentPath = lookup.path;
		},
		createDefaultDirectories: function () {
			FS.mkdir("/tmp");
			FS.mkdir("/home");
			FS.mkdir("/home/web_user");
		},
		createDefaultDevices: function () {
			FS.mkdir("/dev");
			FS.registerDevice(FS.makedev(1, 3), {
				read: function () {
					return 0;
				},
				write: function () {
					return 0;
				}
			});
			FS.mkdev("/dev/null", FS.makedev(1, 3));
			TTY.register(FS.makedev(5, 0), TTY.default_tty_ops);
			TTY.register(FS.makedev(6, 0), TTY.default_tty1_ops);
			FS.mkdev("/dev/tty", FS.makedev(5, 0));
			FS.mkdev("/dev/tty1", FS.makedev(6, 0));
			var random_device;
			if (typeof crypto !== "undefined") {
				var randomBuffer = new Uint8Array(1);
				random_device = function () {
					crypto.getRandomValues(randomBuffer);
					return randomBuffer[0];
				};
			} else if (ENVIRONMENT_IS_NODE) {
				random_device = function () {
					return require("crypto").randomBytes(1)[0];
				};
			} else {
				random_device = function () {
					return Math.random() * 256 | 0;
				};
			}
			FS.createDevice("/dev", "random", random_device);
			FS.createDevice("/dev", "urandom", random_device);
			FS.mkdir("/dev/shm");
			FS.mkdir("/dev/shm/tmp");
		},
		createStandardStreams: function () {
			if (Module["stdin"]) {
				FS.createDevice("/dev", "stdin", Module["stdin"]);
			} else {
				FS.symlink("/dev/tty", "/dev/stdin");
			}
			if (Module["stdout"]) {
				FS.createDevice("/dev", "stdout", null, Module["stdout"]);
			} else {
				FS.symlink("/dev/tty", "/dev/stdout");
			}
			if (Module["stderr"]) {
				FS.createDevice("/dev", "stderr", null, Module["stderr"]);
			} else {
				FS.symlink("/dev/tty1", "/dev/stderr");
			}
			var stdin = FS.open("/dev/stdin", "r");
			HEAP32[_stdin >> 2] = FS.getPtrForStream(stdin);
			assert(stdin.fd === 0, "invalid handle for stdin (" + stdin.fd + ")");
			var stdout = FS.open("/dev/stdout", "w");
			HEAP32[_stdout >> 2] = FS.getPtrForStream(stdout);
			assert(stdout.fd === 1, "invalid handle for stdout (" + stdout.fd + ")");
			var stderr = FS.open("/dev/stderr", "w");
			HEAP32[_stderr >> 2] = FS.getPtrForStream(stderr);
			assert(stderr.fd === 2, "invalid handle for stderr (" + stderr.fd + ")");
		},
		ensureErrnoError: function () {
			if (FS.ErrnoError) return;
			FS.ErrnoError = function ErrnoError(errno, node) {
				this.node = node;
				this.setErrno = function (errno) {
					this.errno = errno;
					for (var key in ERRNO_CODES) {
						if (ERRNO_CODES[key] === errno) {
							this.code = key;
							break;
						}
					}
				};
				this.setErrno(errno);
				this.message = ERRNO_MESSAGES[errno];
			};
			FS.ErrnoError.prototype = new Error();
			FS.ErrnoError.prototype.constructor = FS.ErrnoError;
			[ERRNO_CODES.ENOENT].forEach(function (code) {
				FS.genericErrors[code] = new FS.ErrnoError(code);
				FS.genericErrors[code].stack = "<generic error, no stack>";
			});
		},
		staticInit: function () {
			FS.ensureErrnoError();
			FS.nameTable = new Array(4096);
			FS.mount(MEMFS, {}, "/");
			FS.createDefaultDirectories();
			FS.createDefaultDevices();
		},
		init: function (input, output, error) {
			assert(!FS.init.initialized, "FS.init was previously called. If you want to initialize later with custom parameters, remove any earlier calls (note that one is automatically added to the generated code)");
			FS.init.initialized = true;
			FS.ensureErrnoError();
			Module["stdin"] = input || Module["stdin"];
			Module["stdout"] = output || Module["stdout"];
			Module["stderr"] = error || Module["stderr"];
			FS.createStandardStreams();
		},
		quit: function () {
			FS.init.initialized = false;
			for (var i = 0; i < FS.streams.length; i++) {
				var stream = FS.streams[i];
				if (!stream) {
					continue;
				}
				FS.close(stream);
			}
		},
		getMode: function (canRead, canWrite) {
			var mode = 0;
			if (canRead) mode |= 292 | 73;
			if (canWrite) mode |= 146;
			return mode;
		},
		joinPath: function (parts, forceRelative) {
			var path = PATH.join.apply(null, parts);
			if (forceRelative && path[0] == "/") path = path.substr(1);
			return path;
		},
		absolutePath: function (relative, base) {
			return PATH.resolve(base, relative);
		},
		standardizePath: function (path) {
			return PATH.normalize(path);
		},
		findObject: function (path, dontResolveLastLink) {
			var ret = FS.analyzePath(path, dontResolveLastLink);
			if (ret.exists) {
				return ret.object;
			} else {
				___setErrNo(ret.error);
				return null;
			}
		},
		analyzePath: function (path, dontResolveLastLink) {
			try {
				var lookup = FS.lookupPath(path, {
					follow: !dontResolveLastLink
				});
				path = lookup.path;
			} catch (e) { }
			var ret = {
				isRoot: false,
				exists: false,
				error: 0,
				name: null,
				path: null,
				object: null,
				parentExists: false,
				parentPath: null,
				parentObject: null
			};
			try {
				var lookup = FS.lookupPath(path, {
					parent: true
				});
				ret.parentExists = true;
				ret.parentPath = lookup.path;
				ret.parentObject = lookup.node;
				ret.name = PATH.basename(path);
				lookup = FS.lookupPath(path, {
					follow: !dontResolveLastLink
				});
				ret.exists = true;
				ret.path = lookup.path;
				ret.object = lookup.node;
				ret.name = lookup.node.name;
				ret.isRoot = lookup.path === "/";
			} catch (e) {
				ret.error = e.errno;
			}
			return ret;
		},
		createFolder: function (parent, name, canRead, canWrite) {
			var path = PATH.join2(typeof parent === "string" ? parent : FS.getPath(parent), name);
			var mode = FS.getMode(canRead, canWrite);
			return FS.mkdir(path, mode);
		},
		createPath: function (parent, path, canRead, canWrite) {
			parent = typeof parent === "string" ? parent : FS.getPath(parent);
			var parts = path.split("/").reverse();
			while (parts.length) {
				var part = parts.pop();
				if (!part) continue;
				var current = PATH.join2(parent, part);
				try {
					FS.mkdir(current);
				} catch (e) { }
				parent = current;
			}
			return current;
		},
		createFile: function (parent, name, properties, canRead, canWrite) {
			var path = PATH.join2(typeof parent === "string" ? parent : FS.getPath(parent), name);
			var mode = FS.getMode(canRead, canWrite);
			return FS.create(path, mode);
		},
		createDataFile: function (parent, name, data, canRead, canWrite, canOwn) {
			var path = name ? PATH.join2(typeof parent === "string" ? parent : FS.getPath(parent), name) : parent;
			var mode = FS.getMode(canRead, canWrite);
			var node = FS.create(path, mode);
			if (data) {
				if (typeof data === "string") {
					var arr = new Array(data.length);
					for (var i = 0, len = data.length; i < len; ++i) arr[i] = data.charCodeAt(i);
					data = arr;
				}
				FS.chmod(node, mode | 146);
				var stream = FS.open(node, "w");
				FS.write(stream, data, 0, data.length, 0, canOwn);
				FS.close(stream);
				FS.chmod(node, mode);
			}
			return node;
		},
		createDevice: function (parent, name, input, output) {
			var path = PATH.join2(typeof parent === "string" ? parent : FS.getPath(parent), name);
			var mode = FS.getMode(!!input, !!output);
			if (!FS.createDevice.major) FS.createDevice.major = 64;
			var dev = FS.makedev(FS.createDevice.major++, 0);
			FS.registerDevice(dev, {
				open: function (stream) {
					stream.seekable = false;
				},
				close: function (stream) {
					if (output && output.buffer && output.buffer.length) {
						output(10);
					}
				},
				read: function (stream, buffer, offset, length, pos) {
					var bytesRead = 0;
					for (var i = 0; i < length; i++) {
						var result;
						try {
							result = input();
						} catch (e) {
							throw new FS.ErrnoError(ERRNO_CODES.EIO);
						}
						if (result === undefined && bytesRead === 0) {
							throw new FS.ErrnoError(ERRNO_CODES.EAGAIN);
						}
						if (result === null || result === undefined) break;
						bytesRead++;
						buffer[offset + i] = result;
					}
					if (bytesRead) {
						stream.node.timestamp = Date.now();
					}
					return bytesRead;
				},
				write: function (stream, buffer, offset, length, pos) {
					for (var i = 0; i < length; i++) {
						try {
							output(buffer[offset + i]);
						} catch (e) {
							throw new FS.ErrnoError(ERRNO_CODES.EIO);
						}
					}
					if (length) {
						stream.node.timestamp = Date.now();
					}
					return i;
				}
			});
			return FS.mkdev(path, mode, dev);
		},
		createLink: function (parent, name, target, canRead, canWrite) {
			var path = PATH.join2(typeof parent === "string" ? parent : FS.getPath(parent), name);
			return FS.symlink(target, path);
		},
		forceLoadFile: function (obj) {
			if (obj.isDevice || obj.isFolder || obj.link || obj.contents) return true;
			var success = true;
			if (typeof XMLHttpRequest !== "undefined") {
				throw new Error("Lazy loading should have been performed (contents set) in createLazyFile, but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file in emcc on the main thread.");
			} else if (Module["read"]) {
				try {
					obj.contents = intArrayFromString(Module["read"](obj.url), true);
					obj.usedBytes = obj.contents.length;
				} catch (e) {
					success = false;
				}
			} else {
				throw new Error("Cannot load without read() or XMLHttpRequest.");
			}
			if (!success) ___setErrNo(ERRNO_CODES.EIO);
			return success;
		},
		createLazyFile: function (parent, name, url, canRead, canWrite) {
			function LazyUint8Array() {
				this.lengthKnown = false;
				this.chunks = [];
			}
			LazyUint8Array.prototype.get = function LazyUint8Array_get(idx) {
				if (idx > this.length - 1 || idx < 0) {
					return undefined;
				}
				var chunkOffset = idx % this.chunkSize;
				var chunkNum = idx / this.chunkSize | 0;
				return this.getter(chunkNum)[chunkOffset];
			};
			LazyUint8Array.prototype.setDataGetter = function LazyUint8Array_setDataGetter(getter) {
				this.getter = getter;
			};
			LazyUint8Array.prototype.cacheLength = function LazyUint8Array_cacheLength() {
				var xhr = new XMLHttpRequest();
				xhr.open("HEAD", url, false);
				xhr.send(null);
				if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) throw new Error("Couldn't load " + url + ". Status: " + xhr.status);
				var datalength = Number(xhr.getResponseHeader("Content-length"));
				var header;
				var hasByteServing = (header = xhr.getResponseHeader("Accept-Ranges")) && header === "bytes";
				var chunkSize = 1024 * 1024;
				if (!hasByteServing) chunkSize = datalength;
				var doXHR = function (from, to) {
					if (from > to) throw new Error("invalid range (" + from + ", " + to + ") or no bytes requested!");
					if (to > datalength - 1) throw new Error("only " + datalength + " bytes available! programmer error!");
					var xhr = new XMLHttpRequest();
					xhr.open("GET", url, false);
					if (datalength !== chunkSize) xhr.setRequestHeader("Range", "bytes=" + from + "-" + to);
					if (typeof Uint8Array != "undefined") xhr.responseType = "arraybuffer";
					if (xhr.overrideMimeType) {
						xhr.overrideMimeType("text/plain; charset=x-user-defined");
					}
					xhr.send(null);
					if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) throw new Error("Couldn't load " + url + ". Status: " + xhr.status);
					if (xhr.response !== undefined) {
						return new Uint8Array(xhr.response || []);
					} else {
						return intArrayFromString(xhr.responseText || "", true);
					}
				};
				var lazyArray = this;
				lazyArray.setDataGetter(function (chunkNum) {
					var start = chunkNum * chunkSize;
					var end = (chunkNum + 1) * chunkSize - 1;
					end = Math.min(end, datalength - 1);
					if (typeof lazyArray.chunks[chunkNum] === "undefined") {
						lazyArray.chunks[chunkNum] = doXHR(start, end);
					}
					if (typeof lazyArray.chunks[chunkNum] === "undefined") throw new Error("doXHR failed!");
					return lazyArray.chunks[chunkNum];
				});
				this._length = datalength;
				this._chunkSize = chunkSize;
				this.lengthKnown = true;
			};
			if (typeof XMLHttpRequest !== "undefined") {
				if (!ENVIRONMENT_IS_WORKER) throw "Cannot do synchronous binary XHRs outside webworkers in modern browsers. Use --embed-file or --preload-file in emcc";
				var lazyArray = new LazyUint8Array();
				Object.defineProperty(lazyArray, "length", {
					get: function () {
						if (!this.lengthKnown) {
							this.cacheLength();
						}
						return this._length;
					}
				});
				Object.defineProperty(lazyArray, "chunkSize", {
					get: function () {
						if (!this.lengthKnown) {
							this.cacheLength();
						}
						return this._chunkSize;
					}
				});
				var properties = {
					isDevice: false,
					contents: lazyArray
				};
			} else {
				var properties = {
					isDevice: false,
					url: url
				};
			}
			var node = FS.createFile(parent, name, properties, canRead, canWrite);
			if (properties.contents) {
				node.contents = properties.contents;
			} else if (properties.url) {
				node.contents = null;
				node.url = properties.url;
			}
			Object.defineProperty(node, "usedBytes", {
				get: function () {
					return this.contents.length;
				}
			});
			var stream_ops = {};
			var keys = Object.keys(node.stream_ops);
			keys.forEach(function (key) {
				var fn = node.stream_ops[key];
				stream_ops[key] = function forceLoadLazyFile() {
					if (!FS.forceLoadFile(node)) {
						throw new FS.ErrnoError(ERRNO_CODES.EIO);
					}
					return fn.apply(null, arguments);
				};
			});
			stream_ops.read = function stream_ops_read(stream, buffer, offset, length, position) {
				if (!FS.forceLoadFile(node)) {
					throw new FS.ErrnoError(ERRNO_CODES.EIO);
				}
				var contents = stream.node.contents;
				if (position >= contents.length) return 0;
				var size = Math.min(contents.length - position, length);
				assert(size >= 0);
				if (contents.slice) {
					for (var i = 0; i < size; i++) {
						buffer[offset + i] = contents[position + i];
					}
				} else {
					for (var i = 0; i < size; i++) {
						buffer[offset + i] = contents.get(position + i);
					}
				}
				return size;
			};
			node.stream_ops = stream_ops;
			return node;
		},
		createPreloadedFile: function (parent, name, url, canRead, canWrite, onload, onerror, dontCreateFile, canOwn) {
			Browser.init();
			var fullname = name ? PATH.resolve(PATH.join2(parent, name)) : parent;
			function processData(byteArray) {
				function finish(byteArray) {
					if (!dontCreateFile) {
						FS.createDataFile(parent, name, byteArray, canRead, canWrite, canOwn);
					}
					if (onload) onload();
					removeRunDependency("cp " + fullname);
				}
				var handled = false;
				Module["preloadPlugins"].forEach(function (plugin) {
					if (handled) return;
					if (plugin["canHandle"](fullname)) {
						plugin["handle"](byteArray, fullname, finish, function () {
							if (onerror) onerror();
							removeRunDependency("cp " + fullname);
						});
						handled = true;
					}
				});
				if (!handled) finish(byteArray);
			}
			addRunDependency("cp " + fullname);
			if (typeof url == "string") {
				Browser.asyncLoad(url, function (byteArray) {
					processData(byteArray);
				}, onerror);
			} else {
				processData(url);
			}
		},
		indexedDB: function () {
			return window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
		},
		DB_NAME: function () {
			return "EM_FS_" + window.location.pathname;
		},
		DB_VERSION: 20,
		DB_STORE_NAME: "FILE_DATA",
		saveFilesToDB: function (paths, onload, onerror) {
			onload = onload || function () { };
			onerror = onerror || function () { };
			var indexedDB = FS.indexedDB();
			try {
				var openRequest = indexedDB.open(FS.DB_NAME(), FS.DB_VERSION);
			} catch (e) {
				return onerror(e);
			}
			openRequest.onupgradeneeded = function openRequest_onupgradeneeded() {
				console.log("creating db");
				var db = openRequest.result;
				db.createObjectStore(FS.DB_STORE_NAME);
			};
			openRequest.onsuccess = function openRequest_onsuccess() {
				var db = openRequest.result;
				var transaction = db.transaction([FS.DB_STORE_NAME], "readwrite");
				var files = transaction.objectStore(FS.DB_STORE_NAME);
				var ok = 0, fail = 0, total = paths.length;
				function finish() {
					if (fail == 0) onload(); else onerror();
				}
				paths.forEach(function (path) {
					var putRequest = files.put(FS.analyzePath(path).object.contents, path);
					putRequest.onsuccess = function putRequest_onsuccess() {
						ok++;
						if (ok + fail == total) finish();
					};
					putRequest.onerror = function putRequest_onerror() {
						fail++;
						if (ok + fail == total) finish();
					};
				});
				transaction.onerror = onerror;
			};
			openRequest.onerror = onerror;
		},
		loadFilesFromDB: function (paths, onload, onerror) {
			onload = onload || function () { };
			onerror = onerror || function () { };
			var indexedDB = FS.indexedDB();
			try {
				var openRequest = indexedDB.open(FS.DB_NAME(), FS.DB_VERSION);
			} catch (e) {
				return onerror(e);
			}
			openRequest.onupgradeneeded = onerror;
			openRequest.onsuccess = function openRequest_onsuccess() {
				var db = openRequest.result;
				try {
					var transaction = db.transaction([FS.DB_STORE_NAME], "readonly");
				} catch (e) {
					onerror(e);
					return;
				}
				var files = transaction.objectStore(FS.DB_STORE_NAME);
				var ok = 0, fail = 0, total = paths.length;
				function finish() {
					if (fail == 0) onload(); else onerror();
				}
				paths.forEach(function (path) {
					var getRequest = files.get(path);
					getRequest.onsuccess = function getRequest_onsuccess() {
						if (FS.analyzePath(path).exists) {
							FS.unlink(path);
						}
						FS.createDataFile(PATH.dirname(path), PATH.basename(path), getRequest.result, true, true, true);
						ok++;
						if (ok + fail == total) finish();
					};
					getRequest.onerror = function getRequest_onerror() {
						fail++;
						if (ok + fail == total) finish();
					};
				});
				transaction.onerror = onerror;
			};
			openRequest.onerror = onerror;
		}
	};
	function _mkport() {
		throw "TODO";
	}
	var SOCKFS = {
		mount: function (mount) {
			Module["websocket"] = Module["websocket"] && "object" === typeof Module["websocket"] ? Module["websocket"] : {};
			Module["websocket"]._callbacks = {};
			Module["websocket"]["on"] = function (event, callback) {
				if ("function" === typeof callback) {
					this._callbacks[event] = callback;
				}
				return this;
			};
			Module["websocket"].emit = function (event, param) {
				if ("function" === typeof this._callbacks[event]) {
					this._callbacks[event].call(this, param);
				}
			};
			return FS.createNode(null, "/", 16384 | 511, 0);
		},
		createSocket: function (family, type, protocol) {
			var streaming = type == 1;
			if (protocol) {
				assert(streaming == (protocol == 6));
			}
			var sock = {
				family: family,
				type: type,
				protocol: protocol,
				server: null,
				error: null,
				peers: {},
				pending: [],
				recv_queue: [],
				sock_ops: SOCKFS.websocket_sock_ops
			};
			var name = SOCKFS.nextname();
			var node = FS.createNode(SOCKFS.root, name, 49152, 0);
			node.sock = sock;
			var stream = FS.createStream({
				path: name,
				node: node,
				flags: FS.modeStringToFlags("r+"),
				seekable: false,
				stream_ops: SOCKFS.stream_ops
			});
			sock.stream = stream;
			return sock;
		},
		getSocket: function (fd) {
			var stream = FS.getStream(fd);
			if (!stream || !FS.isSocket(stream.node.mode)) {
				return null;
			}
			return stream.node.sock;
		},
		stream_ops: {
			poll: function (stream) {
				var sock = stream.node.sock;
				return sock.sock_ops.poll(sock);
			},
			ioctl: function (stream, request, varargs) {
				var sock = stream.node.sock;
				return sock.sock_ops.ioctl(sock, request, varargs);
			},
			read: function (stream, buffer, offset, length, position) {
				var sock = stream.node.sock;
				var msg = sock.sock_ops.recvmsg(sock, length);
				if (!msg) {
					return 0;
				}
				buffer.set(msg.buffer, offset);
				return msg.buffer.length;
			},
			write: function (stream, buffer, offset, length, position) {
				var sock = stream.node.sock;
				return sock.sock_ops.sendmsg(sock, buffer, offset, length);
			},
			close: function (stream) {
				var sock = stream.node.sock;
				sock.sock_ops.close(sock);
			}
		},
		nextname: function () {
			if (!SOCKFS.nextname.current) {
				SOCKFS.nextname.current = 0;
			}
			return "socket[" + SOCKFS.nextname.current++ + "]";
		}
	};
	function _send(fd, buf, len, flags) {
		var sock = SOCKFS.getSocket(fd);
		if (!sock) {
			___setErrNo(ERRNO_CODES.EBADF);
			return -1;
		}
		return _write(fd, buf, len);
	}
	function _pwrite(fildes, buf, nbyte, offset) {
		var stream = FS.getStream(fildes);
		if (!stream) {
			___setErrNo(ERRNO_CODES.EBADF);
			return -1;
		}
		try {
			var slab = HEAP8;
			return FS.write(stream, slab, buf, nbyte, offset);
		} catch (e) {
			FS.handleFSError(e);
			return -1;
		}
	}
	function _write(fildes, buf, nbyte) {
		var stream = FS.getStream(fildes);
		if (!stream) {
			___setErrNo(ERRNO_CODES.EBADF);
			return -1;
		}
		try {
			var slab = HEAP8;
			return FS.write(stream, slab, buf, nbyte);
		} catch (e) {
			FS.handleFSError(e);
			return -1;
		}
	}
	function _fileno(stream) {
		stream = FS.getStreamFromPtr(stream);
		if (!stream) return -1;
		return stream.fd;
	}
	function _fputc(c, stream) {
		var chr = unSign(c & 255);
		HEAP8[_fputc.ret >> 0] = chr;
		var fd = _fileno(stream);
		var ret = _write(fd, _fputc.ret, 1);
		if (ret == -1) {
			var streamObj = FS.getStreamFromPtr(stream);
			if (streamObj) streamObj.error = true;
			return -1;
		} else {
			return chr;
		}
	}
	var PTHREAD_SPECIFIC = {};
	function _pthread_getspecific(key) {
		return PTHREAD_SPECIFIC[key] || 0;
	}
	function _sysconf(name) {
		switch (name) {
			case 30:
				return PAGE_SIZE;

			case 132:
			case 133:
			case 12:
			case 137:
			case 138:
			case 15:
			case 235:
			case 16:
			case 17:
			case 18:
			case 19:
			case 20:
			case 149:
			case 13:
			case 10:
			case 236:
			case 153:
			case 9:
			case 21:
			case 22:
			case 159:
			case 154:
			case 14:
			case 77:
			case 78:
			case 139:
			case 80:
			case 81:
			case 79:
			case 82:
			case 68:
			case 67:
			case 164:
			case 11:
			case 29:
			case 47:
			case 48:
			case 95:
			case 52:
			case 51:
			case 46:
				return 200809;

			case 27:
			case 246:
			case 127:
			case 128:
			case 23:
			case 24:
			case 160:
			case 161:
			case 181:
			case 182:
			case 242:
			case 183:
			case 184:
			case 243:
			case 244:
			case 245:
			case 165:
			case 178:
			case 179:
			case 49:
			case 50:
			case 168:
			case 169:
			case 175:
			case 170:
			case 171:
			case 172:
			case 97:
			case 76:
			case 32:
			case 173:
			case 35:
				return -1;

			case 176:
			case 177:
			case 7:
			case 155:
			case 8:
			case 157:
			case 125:
			case 126:
			case 92:
			case 93:
			case 129:
			case 130:
			case 131:
			case 94:
			case 91:
				return 1;

			case 74:
			case 60:
			case 69:
			case 70:
			case 4:
				return 1024;

			case 31:
			case 42:
			case 72:
				return 32;

			case 87:
			case 26:
			case 33:
				return 2147483647;

			case 34:
			case 1:
				return 47839;

			case 38:
			case 36:
				return 99;

			case 43:
			case 37:
				return 2048;

			case 0:
				return 2097152;

			case 3:
				return 65536;

			case 28:
				return 32768;

			case 44:
				return 32767;

			case 75:
				return 16384;

			case 39:
				return 1e3;

			case 89:
				return 700;

			case 71:
				return 256;

			case 40:
				return 255;

			case 2:
				return 100;

			case 180:
				return 64;

			case 25:
				return 20;

			case 5:
				return 16;

			case 6:
				return 6;

			case 73:
				return 4;

			case 84:
				{
					if (typeof navigator === "object") return navigator["hardwareConcurrency"] || 1;
					return 1;
				}
		}
		___setErrNo(ERRNO_CODES.EINVAL);
		return -1;
	}
	var PTHREAD_SPECIFIC_NEXT_KEY = 1;
	function _pthread_key_create(key, destructor) {
		if (key == 0) {
			return ERRNO_CODES.EINVAL;
		}
		HEAP32[key >> 2] = PTHREAD_SPECIFIC_NEXT_KEY;
		PTHREAD_SPECIFIC[PTHREAD_SPECIFIC_NEXT_KEY] = 0;
		PTHREAD_SPECIFIC_NEXT_KEY++;
		return 0;
	}
	var _sqrt = Math_sqrt;
	function count_emval_handles() {
		var count = 0;
		for (var i = 5; i < emval_handle_array.length; ++i) {
			if (emval_handle_array[i] !== undefined) {
				++count;
			}
		}
		return count;
	}
	function get_first_emval() {
		for (var i = 1; i < emval_handle_array.length; ++i) {
			if (emval_handle_array[i] !== undefined) {
				return emval_handle_array[i];
			}
		}
		return null;
	}
	function init_emval() {
		Module["count_emval_handles"] = count_emval_handles;
		Module["get_first_emval"] = get_first_emval;
	}
	function __emval_register(value) {
		switch (value) {
			case undefined:
				{
					return 1;
				}
				;

			case null:
				{
					return 2;
				}
				;

			case true:
				{
					return 3;
				}
				;

			case false:
				{
					return 4;
				}
				;

			default:
				{
					var handle = emval_free_list.length ? emval_free_list.pop() : emval_handle_array.length;
					emval_handle_array[handle] = {
						refcount: 1,
						value: value
					};
					return handle;
				}
		}
	}
	function getTypeName(type) {
		var ptr = ___getTypeName(type);
		var rv = readLatin1String(ptr);
		_free(ptr);
		return rv;
	}
	function requireRegisteredType(rawType, humanName) {
		var impl = registeredTypes[rawType];
		if (undefined === impl) {
			throwBindingError(humanName + " has unknown type " + getTypeName(rawType));
		}
		return impl;
	}
	function __emval_take_value(type, argv) {
		type = requireRegisteredType(type, "_emval_take_value");
		var v = type["readValueFromPointer"](argv);
		return __emval_register(v);
	}
	function _embind_repr(v) {
		if (v === null) {
			return "null";
		}
		var t = typeof v;
		if (t === "object" || t === "array" || t === "function") {
			return v.toString();
		} else {
			return "" + v;
		}
	}
	function integerReadValueFromPointer(name, shift, signed) {
		switch (shift) {
			case 0:
				return signed ? function readS8FromPointer(pointer) {
					return HEAP8[pointer];
				} : function readU8FromPointer(pointer) {
					return HEAPU8[pointer];
				};

			case 1:
				return signed ? function readS16FromPointer(pointer) {
					return HEAP16[pointer >> 1];
				} : function readU16FromPointer(pointer) {
					return HEAPU16[pointer >> 1];
				};

			case 2:
				return signed ? function readS32FromPointer(pointer) {
					return HEAP32[pointer >> 2];
				} : function readU32FromPointer(pointer) {
					return HEAPU32[pointer >> 2];
				};

			default:
				throw new TypeError("Unknown integer type: " + name);
		}
	}
	function __embind_register_integer(primitiveType, name, size, minRange, maxRange) {
		name = readLatin1String(name);
		if (maxRange === -1) {
			maxRange = 4294967295;
		}
		var shift = getShiftFromSize(size);
		var fromWireType = function (value) {
			return value;
		};
		if (minRange === 0) {
			var bitshift = 32 - 8 * size;
			fromWireType = function (value) {
				return value << bitshift >>> bitshift;
			};
		}
		registerType(primitiveType, {
			name: name,
			fromWireType: fromWireType,
			toWireType: function (destructors, value) {
				if (typeof value !== "number" && typeof value !== "boolean") {
					throw new TypeError('Cannot convert "' + _embind_repr(value) + '" to ' + this.name);
				}
				if (value < minRange || value > maxRange) {
					throw new TypeError('Passing a number "' + _embind_repr(value) + '" from JS side to C/C++ side to an argument of type "' + name + '", which is outside the valid range [' + minRange + ", " + maxRange + "]!");
				}
				return value | 0;
			},
			argPackAdvance: 8,
			readValueFromPointer: integerReadValueFromPointer(name, shift, minRange !== 0),
			destructorFunction: null
		});
	}
	function __embind_register_emval(rawType, name) {
		name = readLatin1String(name);
		registerType(rawType, {
			name: name,
			fromWireType: function (handle) {
				var rv = emval_handle_array[handle].value;
				__emval_decref(handle);
				return rv;
			},
			toWireType: function (destructors, value) {
				return __emval_register(value);
			},
			argPackAdvance: 8,
			readValueFromPointer: simpleReadValueFromPointer,
			destructorFunction: null
		});
	}
	function _pthread_setspecific(key, value) {
		if (!(key in PTHREAD_SPECIFIC)) {
			return ERRNO_CODES.EINVAL;
		}
		PTHREAD_SPECIFIC[key] = value;
		return 0;
	}
	function _emscripten_set_main_loop_timing(mode, value) {
		Browser.mainLoop.timingMode = mode;
		Browser.mainLoop.timingValue = value;
		if (!Browser.mainLoop.func) {
			return 1;
		}
		if (mode == 0) {
			Browser.mainLoop.scheduler = function Browser_mainLoop_scheduler() {
				setTimeout(Browser.mainLoop.runner, value);
			};
			Browser.mainLoop.method = "timeout";
		} else if (mode == 1) {
			Browser.mainLoop.scheduler = function Browser_mainLoop_scheduler() {
				Browser.requestAnimationFrame(Browser.mainLoop.runner);
			};
			Browser.mainLoop.method = "rAF";
		}
		return 0;
	}
	function _emscripten_set_main_loop(func, fps, simulateInfiniteLoop, arg, noSetTiming) {
		Module["noExitRuntime"] = true;
		assert(!Browser.mainLoop.func, "emscripten_set_main_loop: there can only be one main loop function at once: call emscripten_cancel_main_loop to cancel the previous one before setting a new one with different parameters.");
		Browser.mainLoop.func = func;
		Browser.mainLoop.arg = arg;
		var thisMainLoopId = Browser.mainLoop.currentlyRunningMainloop;
		Browser.mainLoop.runner = function Browser_mainLoop_runner() {
			if (ABORT) return;
			if (Browser.mainLoop.queue.length > 0) {
				var start = Date.now();
				var blocker = Browser.mainLoop.queue.shift();
				blocker.func(blocker.arg);
				if (Browser.mainLoop.remainingBlockers) {
					var remaining = Browser.mainLoop.remainingBlockers;
					var next = remaining % 1 == 0 ? remaining - 1 : Math.floor(remaining);
					if (blocker.counted) {
						Browser.mainLoop.remainingBlockers = next;
					} else {
						next = next + .5;
						Browser.mainLoop.remainingBlockers = (8 * remaining + next) / 9;
					}
				}
				console.log('main loop blocker "' + blocker.name + '" took ' + (Date.now() - start) + " ms");
				Browser.mainLoop.updateStatus();
				setTimeout(Browser.mainLoop.runner, 0);
				return;
			}
			if (thisMainLoopId < Browser.mainLoop.currentlyRunningMainloop) return;
			Browser.mainLoop.currentFrameNumber = Browser.mainLoop.currentFrameNumber + 1 | 0;
			if (Browser.mainLoop.timingMode == 1 && Browser.mainLoop.timingValue > 1 && Browser.mainLoop.currentFrameNumber % Browser.mainLoop.timingValue != 0) {
				Browser.mainLoop.scheduler();
				return;
			}
			if (Browser.mainLoop.method === "timeout" && Module.ctx) {
				Module.printErr("Looks like you are rendering without using requestAnimationFrame for the main loop. You should use 0 for the frame rate in emscripten_set_main_loop in order to use requestAnimationFrame, as that can greatly improve your frame rates!");
				Browser.mainLoop.method = "";
			}
			Browser.mainLoop.runIter(function () {
				if (typeof arg !== "undefined") {
					Runtime.dynCall("vi", func, [arg]);
				} else {
					Runtime.dynCall("v", func);
				}
			});
			if (thisMainLoopId < Browser.mainLoop.currentlyRunningMainloop) return;
			if (typeof SDL === "object" && SDL.audio && SDL.audio.queueNewAudioData) SDL.audio.queueNewAudioData();
			Browser.mainLoop.scheduler();
		};
		if (!noSetTiming) {
			if (fps && fps > 0) _emscripten_set_main_loop_timing(0, 1e3 / fps); else _emscripten_set_main_loop_timing(1, 1);
			Browser.mainLoop.scheduler();
		}
		if (simulateInfiniteLoop) {
			throw "SimulateInfiniteLoop";
		}
	}
	var Browser = {
		mainLoop: {
			scheduler: null,
			method: "",
			currentlyRunningMainloop: 0,
			func: null,
			arg: 0,
			timingMode: 0,
			timingValue: 0,
			currentFrameNumber: 0,
			queue: [],
			pause: function () {
				Browser.mainLoop.scheduler = null;
				Browser.mainLoop.currentlyRunningMainloop++;
			},
			resume: function () {
				Browser.mainLoop.currentlyRunningMainloop++;
				var timingMode = Browser.mainLoop.timingMode;
				var timingValue = Browser.mainLoop.timingValue;
				var func = Browser.mainLoop.func;
				Browser.mainLoop.func = null;
				_emscripten_set_main_loop(func, 0, false, Browser.mainLoop.arg, true);
				_emscripten_set_main_loop_timing(timingMode, timingValue);
				Browser.mainLoop.scheduler();
			},
			updateStatus: function () {
				if (Module["setStatus"]) {
					var message = Module["statusMessage"] || "Please wait...";
					var remaining = Browser.mainLoop.remainingBlockers;
					var expected = Browser.mainLoop.expectedBlockers;
					if (remaining) {
						if (remaining < expected) {
							Module["setStatus"](message + " (" + (expected - remaining) + "/" + expected + ")");
						} else {
							Module["setStatus"](message);
						}
					} else {
						Module["setStatus"]("");
					}
				}
			},
			runIter: function (func) {
				if (ABORT) return;
				if (Module["preMainLoop"]) {
					var preRet = Module["preMainLoop"]();
					if (preRet === false) {
						return;
					}
				}
				try {
					func();
				} catch (e) {
					if (e instanceof ExitStatus) {
						return;
					} else {
						if (e && typeof e === "object" && e.stack) Module.printErr("exception thrown: " + [e, e.stack]);
						throw e;
					}
				}
				if (Module["postMainLoop"]) Module["postMainLoop"]();
			}
		},
		isFullScreen: false,
		pointerLock: false,
		moduleContextCreatedCallbacks: [],
		workers: [],
		init: function () {
			if (!Module["preloadPlugins"]) Module["preloadPlugins"] = [];
			if (Browser.initted) return;
			Browser.initted = true;
			try {
				new Blob();
				Browser.hasBlobConstructor = true;
			} catch (e) {
				Browser.hasBlobConstructor = false;
				console.log("warning: no blob constructor, cannot create blobs with mimetypes");
			}
			Browser.BlobBuilder = typeof MozBlobBuilder != "undefined" ? MozBlobBuilder : typeof WebKitBlobBuilder != "undefined" ? WebKitBlobBuilder : !Browser.hasBlobConstructor ? console.log("warning: no BlobBuilder") : null;
			Browser.URLObject = typeof window != "undefined" ? window.URL ? window.URL : window.webkitURL : undefined;
			if (!Module.noImageDecoding && typeof Browser.URLObject === "undefined") {
				console.log("warning: Browser does not support creating object URLs. Built-in browser image decoding will not be available.");
				Module.noImageDecoding = true;
			}
			var imagePlugin = {};
			imagePlugin["canHandle"] = function imagePlugin_canHandle(name) {
				return !Module.noImageDecoding && /\.(jpg|jpeg|png|bmp)$/i.test(name);
			};
			imagePlugin["handle"] = function imagePlugin_handle(byteArray, name, onload, onerror) {
				var b = null;
				if (Browser.hasBlobConstructor) {
					try {
						b = new Blob([byteArray], {
							type: Browser.getMimetype(name)
						});
						if (b.size !== byteArray.length) {
							b = new Blob([new Uint8Array(byteArray).buffer], {
								type: Browser.getMimetype(name)
							});
						}
					} catch (e) {
						Runtime.warnOnce("Blob constructor present but fails: " + e + "; falling back to blob builder");
					}
				}
				if (!b) {
					var bb = new Browser.BlobBuilder();
					bb.append(new Uint8Array(byteArray).buffer);
					b = bb.getBlob();
				}
				var url = Browser.URLObject.createObjectURL(b);
				var img = new Image();
				img.onload = function img_onload() {
					assert(img.complete, "Image " + name + " could not be decoded");
					var canvas = document.createElement("canvas");
					canvas.width = img.width;
					canvas.height = img.height;
					var ctx = canvas.getContext("2d");
					ctx.drawImage(img, 0, 0);
					Module["preloadedImages"][name] = canvas;
					Browser.URLObject.revokeObjectURL(url);
					if (onload) onload(byteArray);
				};
				img.onerror = function img_onerror(event) {
					console.log("Image " + url + " could not be decoded");
					if (onerror) onerror();
				};
				img.src = url;
			};
			Module["preloadPlugins"].push(imagePlugin);
			var audioPlugin = {};
			audioPlugin["canHandle"] = function audioPlugin_canHandle(name) {
				return !Module.noAudioDecoding && name.substr(-4) in {
					".ogg": 1,
					".wav": 1,
					".mp3": 1
				};
			};
			audioPlugin["handle"] = function audioPlugin_handle(byteArray, name, onload, onerror) {
				var done = false;
				function finish(audio) {
					if (done) return;
					done = true;
					Module["preloadedAudios"][name] = audio;
					if (onload) onload(byteArray);
				}
				function fail() {
					if (done) return;
					done = true;
					Module["preloadedAudios"][name] = new Audio();
					if (onerror) onerror();
				}
				if (Browser.hasBlobConstructor) {
					try {
						var b = new Blob([byteArray], {
							type: Browser.getMimetype(name)
						});
					} catch (e) {
						return fail();
					}
					var url = Browser.URLObject.createObjectURL(b);
					var audio = new Audio();
					audio.addEventListener("canplaythrough", function () {
						finish(audio);
					}, false);
					audio.onerror = function audio_onerror(event) {
						if (done) return;
						console.log("warning: browser could not fully decode audio " + name + ", trying slower base64 approach");
						function encode64(data) {
							var BASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
							var PAD = "=";
							var ret = "";
							var leftchar = 0;
							var leftbits = 0;
							for (var i = 0; i < data.length; i++) {
								leftchar = leftchar << 8 | data[i];
								leftbits += 8;
								while (leftbits >= 6) {
									var curr = leftchar >> leftbits - 6 & 63;
									leftbits -= 6;
									ret += BASE[curr];
								}
							}
							if (leftbits == 2) {
								ret += BASE[(leftchar & 3) << 4];
								ret += PAD + PAD;
							} else if (leftbits == 4) {
								ret += BASE[(leftchar & 15) << 2];
								ret += PAD;
							}
							return ret;
						}
						audio.src = "data:audio/x-" + name.substr(-3) + ";base64," + encode64(byteArray);
						finish(audio);
					};
					audio.src = url;
					Browser.safeSetTimeout(function () {
						finish(audio);
					}, 1e4);
				} else {
					return fail();
				}
			};
			Module["preloadPlugins"].push(audioPlugin);
			var canvas = Module["canvas"];
			function pointerLockChange() {
				Browser.pointerLock = document["pointerLockElement"] === canvas || document["mozPointerLockElement"] === canvas || document["webkitPointerLockElement"] === canvas || document["msPointerLockElement"] === canvas;
			}
			if (canvas) {
				canvas.requestPointerLock = canvas["requestPointerLock"] || canvas["mozRequestPointerLock"] || canvas["webkitRequestPointerLock"] || canvas["msRequestPointerLock"] || function () { };
				canvas.exitPointerLock = document["exitPointerLock"] || document["mozExitPointerLock"] || document["webkitExitPointerLock"] || document["msExitPointerLock"] || function () { };
				canvas.exitPointerLock = canvas.exitPointerLock.bind(document);
				document.addEventListener("pointerlockchange", pointerLockChange, false);
				document.addEventListener("mozpointerlockchange", pointerLockChange, false);
				document.addEventListener("webkitpointerlockchange", pointerLockChange, false);
				document.addEventListener("mspointerlockchange", pointerLockChange, false);
				if (Module["elementPointerLock"]) {
					canvas.addEventListener("click", function (ev) {
						if (!Browser.pointerLock && canvas.requestPointerLock) {
							canvas.requestPointerLock();
							ev.preventDefault();
						}
					}, false);
				}
			}
		},
		createContext: function (canvas, useWebGL, setInModule, webGLContextAttributes) {
			if (useWebGL && Module.ctx && canvas == Module.canvas) return Module.ctx;
			var ctx;
			var contextHandle;
			if (useWebGL) {
				var contextAttributes = {
					antialias: false,
					alpha: false
				};
				if (webGLContextAttributes) {
					for (var attribute in webGLContextAttributes) {
						contextAttributes[attribute] = webGLContextAttributes[attribute];
					}
				}
				contextHandle = GL.createContext(canvas, contextAttributes);
				if (contextHandle) {
					ctx = GL.getContext(contextHandle).GLctx;
				}
				canvas.style.backgroundColor = "black";
			} else {
				ctx = canvas.getContext("2d");
			}
			if (!ctx) return null;
			if (setInModule) {
				if (!useWebGL) assert(typeof GLctx === "undefined", "cannot set in module if GLctx is used, but we are a non-GL context that would replace it");
				Module.ctx = ctx;
				if (useWebGL) GL.makeContextCurrent(contextHandle);
				Module.useWebGL = useWebGL;
				Browser.moduleContextCreatedCallbacks.forEach(function (callback) {
					callback();
				});
				Browser.init();
			}
			return ctx;
		},
		destroyContext: function (canvas, useWebGL, setInModule) { },
		fullScreenHandlersInstalled: false,
		lockPointer: undefined,
		resizeCanvas: undefined,
		requestFullScreen: function (lockPointer, resizeCanvas, vrDevice) {
			Browser.lockPointer = lockPointer;
			Browser.resizeCanvas = resizeCanvas;
			Browser.vrDevice = vrDevice;
			if (typeof Browser.lockPointer === "undefined") Browser.lockPointer = true;
			if (typeof Browser.resizeCanvas === "undefined") Browser.resizeCanvas = false;
			if (typeof Browser.vrDevice === "undefined") Browser.vrDevice = null;
			var canvas = Module["canvas"];
			function fullScreenChange() {
				Browser.isFullScreen = false;
				var canvasContainer = canvas.parentNode;
				if ((document["webkitFullScreenElement"] || document["webkitFullscreenElement"] || document["mozFullScreenElement"] || document["mozFullscreenElement"] || document["fullScreenElement"] || document["fullscreenElement"] || document["msFullScreenElement"] || document["msFullscreenElement"] || document["webkitCurrentFullScreenElement"]) === canvasContainer) {
					canvas.cancelFullScreen = document["cancelFullScreen"] || document["mozCancelFullScreen"] || document["webkitCancelFullScreen"] || document["msExitFullscreen"] || document["exitFullscreen"] || function () { };
					canvas.cancelFullScreen = canvas.cancelFullScreen.bind(document);
					if (Browser.lockPointer) canvas.requestPointerLock();
					Browser.isFullScreen = true;
					if (Browser.resizeCanvas) Browser.setFullScreenCanvasSize();
				} else {
					canvasContainer.parentNode.insertBefore(canvas, canvasContainer);
					canvasContainer.parentNode.removeChild(canvasContainer);
					if (Browser.resizeCanvas) Browser.setWindowedCanvasSize();
				}
				if (Module["onFullScreen"]) Module["onFullScreen"](Browser.isFullScreen);
				Browser.updateCanvasDimensions(canvas);
			}
			if (!Browser.fullScreenHandlersInstalled) {
				Browser.fullScreenHandlersInstalled = true;
				document.addEventListener("fullscreenchange", fullScreenChange, false);
				document.addEventListener("mozfullscreenchange", fullScreenChange, false);
				document.addEventListener("webkitfullscreenchange", fullScreenChange, false);
				document.addEventListener("MSFullscreenChange", fullScreenChange, false);
			}
			var canvasContainer = document.createElement("div");
			canvas.parentNode.insertBefore(canvasContainer, canvas);
			canvasContainer.appendChild(canvas);
			canvasContainer.requestFullScreen = canvasContainer["requestFullScreen"] || canvasContainer["mozRequestFullScreen"] || canvasContainer["msRequestFullscreen"] || (canvasContainer["webkitRequestFullScreen"] ? function () {
				canvasContainer["webkitRequestFullScreen"](Element["ALLOW_KEYBOARD_INPUT"]);
			} : null);
			if (vrDevice) {
				canvasContainer.requestFullScreen({
					vrDisplay: vrDevice
				});
			} else {
				canvasContainer.requestFullScreen();
			}
		},
		nextRAF: 0,
		fakeRequestAnimationFrame: function (func) {
			var now = Date.now();
			if (Browser.nextRAF === 0) {
				Browser.nextRAF = now + 1e3 / 60;
			} else {
				while (now + 2 >= Browser.nextRAF) {
					Browser.nextRAF += 1e3 / 60;
				}
			}
			var delay = Math.max(Browser.nextRAF - now, 0);
			setTimeout(func, delay);
		},
		requestAnimationFrame: function requestAnimationFrame(func) {
			if (typeof window === "undefined") {
				Browser.fakeRequestAnimationFrame(func);
			} else {
				if (!window.requestAnimationFrame) {
					window.requestAnimationFrame = window["requestAnimationFrame"] || window["mozRequestAnimationFrame"] || window["webkitRequestAnimationFrame"] || window["msRequestAnimationFrame"] || window["oRequestAnimationFrame"] || Browser.fakeRequestAnimationFrame;
				}
				window.requestAnimationFrame(func);
			}
		},
		safeCallback: function (func) {
			return function () {
				if (!ABORT) return func.apply(null, arguments);
			};
		},
		allowAsyncCallbacks: true,
		queuedAsyncCallbacks: [],
		pauseAsyncCallbacks: function () {
			Browser.allowAsyncCallbacks = false;
		},
		resumeAsyncCallbacks: function () {
			Browser.allowAsyncCallbacks = true;
			if (Browser.queuedAsyncCallbacks.length > 0) {
				var callbacks = Browser.queuedAsyncCallbacks;
				Browser.queuedAsyncCallbacks = [];
				callbacks.forEach(function (func) {
					func();
				});
			}
		},
		safeRequestAnimationFrame: function (func) {
			return Browser.requestAnimationFrame(function () {
				if (ABORT) return;
				if (Browser.allowAsyncCallbacks) {
					func();
				} else {
					Browser.queuedAsyncCallbacks.push(func);
				}
			});
		},
		safeSetTimeout: function (func, timeout) {
			Module["noExitRuntime"] = true;
			return setTimeout(function () {
				if (ABORT) return;
				if (Browser.allowAsyncCallbacks) {
					func();
				} else {
					Browser.queuedAsyncCallbacks.push(func);
				}
			}, timeout);
		},
		safeSetInterval: function (func, timeout) {
			Module["noExitRuntime"] = true;
			return setInterval(function () {
				if (ABORT) return;
				if (Browser.allowAsyncCallbacks) {
					func();
				}
			}, timeout);
		},
		getMimetype: function (name) {
			return {
				jpg: "image/jpeg",
				jpeg: "image/jpeg",
				png: "image/png",
				bmp: "image/bmp",
				ogg: "audio/ogg",
				wav: "audio/wav",
				mp3: "audio/mpeg"
			}[name.substr(name.lastIndexOf(".") + 1)];
		},
		getUserMedia: function (func) {
			if (!window.getUserMedia) {
				window.getUserMedia = navigator["getUserMedia"] || navigator["mozGetUserMedia"];
			}
			window.getUserMedia(func);
		},
		getMovementX: function (event) {
			return event["movementX"] || event["mozMovementX"] || event["webkitMovementX"] || 0;
		},
		getMovementY: function (event) {
			return event["movementY"] || event["mozMovementY"] || event["webkitMovementY"] || 0;
		},
		getMouseWheelDelta: function (event) {
			var delta = 0;
			switch (event.type) {
				case "DOMMouseScroll":
					delta = event.detail;
					break;

				case "mousewheel":
					delta = event.wheelDelta;
					break;

				case "wheel":
					delta = event["deltaY"];
					break;

				default:
					throw "unrecognized mouse wheel event: " + event.type;
			}
			return delta;
		},
		mouseX: 0,
		mouseY: 0,
		mouseMovementX: 0,
		mouseMovementY: 0,
		touches: {},
		lastTouches: {},
		calculateMouseEvent: function (event) {
			if (Browser.pointerLock) {
				if (event.type != "mousemove" && "mozMovementX" in event) {
					Browser.mouseMovementX = Browser.mouseMovementY = 0;
				} else {
					Browser.mouseMovementX = Browser.getMovementX(event);
					Browser.mouseMovementY = Browser.getMovementY(event);
				}
				if (typeof SDL != "undefined") {
					Browser.mouseX = SDL.mouseX + Browser.mouseMovementX;
					Browser.mouseY = SDL.mouseY + Browser.mouseMovementY;
				} else {
					Browser.mouseX += Browser.mouseMovementX;
					Browser.mouseY += Browser.mouseMovementY;
				}
			} else {
				var rect = Module["canvas"].getBoundingClientRect();
				var cw = Module["canvas"].width;
				var ch = Module["canvas"].height;
				var scrollX = typeof window.scrollX !== "undefined" ? window.scrollX : window.pageXOffset;
				var scrollY = typeof window.scrollY !== "undefined" ? window.scrollY : window.pageYOffset;
				if (event.type === "touchstart" || event.type === "touchend" || event.type === "touchmove") {
					var touch = event.touch;
					if (touch === undefined) {
						return;
					}
					var adjustedX = touch.pageX - (scrollX + rect.left);
					var adjustedY = touch.pageY - (scrollY + rect.top);
					adjustedX = adjustedX * (cw / rect.width);
					adjustedY = adjustedY * (ch / rect.height);
					var coords = {
						x: adjustedX,
						y: adjustedY
					};
					if (event.type === "touchstart") {
						Browser.lastTouches[touch.identifier] = coords;
						Browser.touches[touch.identifier] = coords;
					} else if (event.type === "touchend" || event.type === "touchmove") {
						Browser.lastTouches[touch.identifier] = Browser.touches[touch.identifier];
						Browser.touches[touch.identifier] = {
							x: adjustedX,
							y: adjustedY
						};
					}
					return;
				}
				var x = event.pageX - (scrollX + rect.left);
				var y = event.pageY - (scrollY + rect.top);
				x = x * (cw / rect.width);
				y = y * (ch / rect.height);
				Browser.mouseMovementX = x - Browser.mouseX;
				Browser.mouseMovementY = y - Browser.mouseY;
				Browser.mouseX = x;
				Browser.mouseY = y;
			}
		},
		xhrLoad: function (url, onload, onerror) {
			var xhr = new XMLHttpRequest();
			xhr.open("GET", url, true);
			xhr.responseType = "arraybuffer";
			xhr.onload = function xhr_onload() {
				if (xhr.status == 200 || xhr.status == 0 && xhr.response) {
					onload(xhr.response);
				} else {
					onerror();
				}
			};
			xhr.onerror = onerror;
			xhr.send(null);
		},
		asyncLoad: function (url, onload, onerror, noRunDep) {
			Browser.xhrLoad(url, function (arrayBuffer) {
				assert(arrayBuffer, 'Loading data file "' + url + '" failed (no arrayBuffer).');
				onload(new Uint8Array(arrayBuffer));
				if (!noRunDep) removeRunDependency("al " + url);
			}, function (event) {
				if (onerror) {
					onerror();
				} else {
					throw 'Loading data file "' + url + '" failed.';
				}
			});
			if (!noRunDep) addRunDependency("al " + url);
		},
		resizeListeners: [],
		updateResizeListeners: function () {
			var canvas = Module["canvas"];
			Browser.resizeListeners.forEach(function (listener) {
				listener(canvas.width, canvas.height);
			});
		},
		setCanvasSize: function (width, height, noUpdates) {
			var canvas = Module["canvas"];
			Browser.updateCanvasDimensions(canvas, width, height);
			if (!noUpdates) Browser.updateResizeListeners();
		},
		windowedWidth: 0,
		windowedHeight: 0,
		setFullScreenCanvasSize: function () {
			if (typeof SDL != "undefined") {
				var flags = HEAPU32[SDL.screen + Runtime.QUANTUM_SIZE * 0 >> 2];
				flags = flags | 8388608;
				HEAP32[SDL.screen + Runtime.QUANTUM_SIZE * 0 >> 2] = flags;
			}
			Browser.updateResizeListeners();
		},
		setWindowedCanvasSize: function () {
			if (typeof SDL != "undefined") {
				var flags = HEAPU32[SDL.screen + Runtime.QUANTUM_SIZE * 0 >> 2];
				flags = flags & ~8388608;
				HEAP32[SDL.screen + Runtime.QUANTUM_SIZE * 0 >> 2] = flags;
			}
			Browser.updateResizeListeners();
		},
		updateCanvasDimensions: function (canvas, wNative, hNative) {
			if (wNative && hNative) {
				canvas.widthNative = wNative;
				canvas.heightNative = hNative;
			} else {
				wNative = canvas.widthNative;
				hNative = canvas.heightNative;
			}
			var w = wNative;
			var h = hNative;
			if (Module["forcedAspectRatio"] && Module["forcedAspectRatio"] > 0) {
				if (w / h < Module["forcedAspectRatio"]) {
					w = Math.round(h * Module["forcedAspectRatio"]);
				} else {
					h = Math.round(w / Module["forcedAspectRatio"]);
				}
			}
			if ((document["webkitFullScreenElement"] || document["webkitFullscreenElement"] || document["mozFullScreenElement"] || document["mozFullscreenElement"] || document["fullScreenElement"] || document["fullscreenElement"] || document["msFullScreenElement"] || document["msFullscreenElement"] || document["webkitCurrentFullScreenElement"]) === canvas.parentNode && typeof screen != "undefined") {
				var factor = Math.min(screen.width / w, screen.height / h);
				w = Math.round(w * factor);
				h = Math.round(h * factor);
			}
			if (Browser.resizeCanvas) {
				if (canvas.width != w) canvas.width = w;
				if (canvas.height != h) canvas.height = h;
				if (typeof canvas.style != "undefined") {
					canvas.style.removeProperty("width");
					canvas.style.removeProperty("height");
				}
			} else {
				if (canvas.width != wNative) canvas.width = wNative;
				if (canvas.height != hNative) canvas.height = hNative;
				if (typeof canvas.style != "undefined") {
					if (w != wNative || h != hNative) {
						canvas.style.setProperty("width", w + "px", "important");
						canvas.style.setProperty("height", h + "px", "important");
					} else {
						canvas.style.removeProperty("width");
						canvas.style.removeProperty("height");
					}
				}
			}
		},
		wgetRequests: {},
		nextWgetRequestHandle: 0,
		getNextWgetRequestHandle: function () {
			var handle = Browser.nextWgetRequestHandle;
			Browser.nextWgetRequestHandle++;
			return handle;
		}
	};
	var _UItoD = true;
	function ___cxa_allocate_exception(size) {
		return _malloc(size);
	}
	Module["_i64Add"] = _i64Add;
	Module["_bitshift64Lshr"] = _bitshift64Lshr;
	function heap32VectorToArray(count, firstElement) {
		var array = [];
		for (var i = 0; i < count; i++) {
			array.push(HEAP32[(firstElement >> 2) + i]);
		}
		return array;
	}
	function __embind_register_class_constructor(rawClassType, argCount, rawArgTypesAddr, invokerSignature, invoker, rawConstructor) {
		var rawArgTypes = heap32VectorToArray(argCount, rawArgTypesAddr);
		invoker = requireFunction(invokerSignature, invoker);
		whenDependentTypesAreResolved([], [rawClassType], function (classType) {
			classType = classType[0];
			var humanName = "constructor " + classType.name;
			if (undefined === classType.registeredClass.constructor_body) {
				classType.registeredClass.constructor_body = [];
			}
			if (undefined !== classType.registeredClass.constructor_body[argCount - 1]) {
				throw new BindingError("Cannot register multiple constructors with identical number of parameters (" + (argCount - 1) + ") for class '" + classType.name + "'! Overload resolution is currently only performed using the parameter count, not actual type info!");
			}
			classType.registeredClass.constructor_body[argCount - 1] = function unboundTypeHandler() {
				throwUnboundTypeError("Cannot construct " + classType.name + " due to unbound types", rawArgTypes);
			};
			whenDependentTypesAreResolved([], rawArgTypes, function (argTypes) {
				classType.registeredClass.constructor_body[argCount - 1] = function constructor_body() {
					if (arguments.length !== argCount - 1) {
						throwBindingError(humanName + " called with " + arguments.length + " arguments, expected " + (argCount - 1));
					}
					var destructors = [];
					var args = new Array(argCount);
					args[0] = rawConstructor;
					for (var i = 1; i < argCount; ++i) {
						args[i] = argTypes[i]["toWireType"](destructors, arguments[i - 1]);
					}
					var ptr = invoker.apply(null, args);
					runDestructors(destructors);
					return argTypes[0]["fromWireType"](ptr);
				};
				return [];
			});
			return [];
		});
	}
	var _llvm_ctlz_i32 = true;
	function floatReadValueFromPointer(name, shift) {
		switch (shift) {
			case 2:
				return function (pointer) {
					return this["fromWireType"](HEAPF32[pointer >> 2]);
				};

			case 3:
				return function (pointer) {
					return this["fromWireType"](HEAPF64[pointer >> 3]);
				};

			default:
				throw new TypeError("Unknown float type: " + name);
		}
	}
	function __embind_register_float(rawType, name, size) {
		var shift = getShiftFromSize(size);
		name = readLatin1String(name);
		registerType(rawType, {
			name: name,
			fromWireType: function (value) {
				return value;
			},
			toWireType: function (destructors, value) {
				if (typeof value !== "number" && typeof value !== "boolean") {
					throw new TypeError('Cannot convert "' + _embind_repr(value) + '" to ' + this.name);
				}
				return value;
			},
			argPackAdvance: 8,
			readValueFromPointer: floatReadValueFromPointer(name, shift),
			destructorFunction: null
		});
	}
	var _BDtoIHigh = true;
	function _fwrite(ptr, size, nitems, stream) {
		var bytesToWrite = nitems * size;
		if (bytesToWrite == 0) return 0;
		var fd = _fileno(stream);
		var bytesWritten = _write(fd, ptr, bytesToWrite);
		if (bytesWritten == -1) {
			var streamObj = FS.getStreamFromPtr(stream);
			if (streamObj) streamObj.error = true;
			return 0;
		} else {
			return bytesWritten / size | 0;
		}
	}
	function __reallyNegative(x) {
		return x < 0 || x === 0 && 1 / x === -Infinity;
	}
	function __formatString(format, varargs) {
		assert((varargs & 7) === 0);
		var textIndex = format;
		var argIndex = 0;
		function getNextArg(type) {
			var ret;
			argIndex = Runtime.prepVararg(argIndex, type);
			if (type === "double") {
				ret = (HEAP32[tempDoublePtr >> 2] = HEAP32[varargs + argIndex >> 2], HEAP32[tempDoublePtr + 4 >> 2] = HEAP32[varargs + (argIndex + 4) >> 2],
					+HEAPF64[tempDoublePtr >> 3]);
				argIndex += 8;
			} else if (type == "i64") {
				ret = [HEAP32[varargs + argIndex >> 2], HEAP32[varargs + (argIndex + 4) >> 2]];
				argIndex += 8;
			} else {
				assert((argIndex & 3) === 0);
				type = "i32";
				ret = HEAP32[varargs + argIndex >> 2];
				argIndex += 4;
			}
			return ret;
		}
		var ret = [];
		var curr, next, currArg;
		while (1) {
			var startTextIndex = textIndex;
			curr = HEAP8[textIndex >> 0];
			if (curr === 0) break;
			next = HEAP8[textIndex + 1 >> 0];
			if (curr == 37) {
				var flagAlwaysSigned = false;
				var flagLeftAlign = false;
				var flagAlternative = false;
				var flagZeroPad = false;
				var flagPadSign = false;
				flagsLoop: while (1) {
					switch (next) {
						case 43:
							flagAlwaysSigned = true;
							break;

						case 45:
							flagLeftAlign = true;
							break;

						case 35:
							flagAlternative = true;
							break;

						case 48:
							if (flagZeroPad) {
								break flagsLoop;
							} else {
								flagZeroPad = true;
								break;
							}
							;

						case 32:
							flagPadSign = true;
							break;

						default:
							break flagsLoop;
					}
					textIndex++;
					next = HEAP8[textIndex + 1 >> 0];
				}
				var width = 0;
				if (next == 42) {
					width = getNextArg("i32");
					textIndex++;
					next = HEAP8[textIndex + 1 >> 0];
				} else {
					while (next >= 48 && next <= 57) {
						width = width * 10 + (next - 48);
						textIndex++;
						next = HEAP8[textIndex + 1 >> 0];
					}
				}
				var precisionSet = false, precision = -1;
				if (next == 46) {
					precision = 0;
					precisionSet = true;
					textIndex++;
					next = HEAP8[textIndex + 1 >> 0];
					if (next == 42) {
						precision = getNextArg("i32");
						textIndex++;
					} else {
						while (1) {
							var precisionChr = HEAP8[textIndex + 1 >> 0];
							if (precisionChr < 48 || precisionChr > 57) break;
							precision = precision * 10 + (precisionChr - 48);
							textIndex++;
						}
					}
					next = HEAP8[textIndex + 1 >> 0];
				}
				if (precision < 0) {
					precision = 6;
					precisionSet = false;
				}
				var argSize;
				switch (String.fromCharCode(next)) {
					case "h":
						var nextNext = HEAP8[textIndex + 2 >> 0];
						if (nextNext == 104) {
							textIndex++;
							argSize = 1;
						} else {
							argSize = 2;
						}
						break;

					case "l":
						var nextNext = HEAP8[textIndex + 2 >> 0];
						if (nextNext == 108) {
							textIndex++;
							argSize = 8;
						} else {
							argSize = 4;
						}
						break;

					case "L":
					case "q":
					case "j":
						argSize = 8;
						break;

					case "z":
					case "t":
					case "I":
						argSize = 4;
						break;

					default:
						argSize = null;
				}
				if (argSize) textIndex++;
				next = HEAP8[textIndex + 1 >> 0];
				switch (String.fromCharCode(next)) {
					case "d":
					case "i":
					case "u":
					case "o":
					case "x":
					case "X":
					case "p":
						{
							var signed = next == 100 || next == 105;
							argSize = argSize || 4;
							var currArg = getNextArg("i" + argSize * 8);
							var origArg = currArg;
							var argText;
							if (argSize == 8) {
								currArg = Runtime.makeBigInt(currArg[0], currArg[1], next == 117);
							}
							if (argSize <= 4) {
								var limit = Math.pow(256, argSize) - 1;
								currArg = (signed ? reSign : unSign)(currArg & limit, argSize * 8);
							}
							var currAbsArg = Math.abs(currArg);
							var prefix = "";
							if (next == 100 || next == 105) {
								if (argSize == 8 && i64Math) argText = i64Math.stringify(origArg[0], origArg[1], null); else argText = reSign(currArg, 8 * argSize, 1).toString(10);
							} else if (next == 117) {
								if (argSize == 8 && i64Math) argText = i64Math.stringify(origArg[0], origArg[1], true); else argText = unSign(currArg, 8 * argSize, 1).toString(10);
								currArg = Math.abs(currArg);
							} else if (next == 111) {
								argText = (flagAlternative ? "0" : "") + currAbsArg.toString(8);
							} else if (next == 120 || next == 88) {
								prefix = flagAlternative && currArg != 0 ? "0x" : "";
								if (argSize == 8 && i64Math) {
									if (origArg[1]) {
										argText = (origArg[1] >>> 0).toString(16);
										var lower = (origArg[0] >>> 0).toString(16);
										while (lower.length < 8) lower = "0" + lower;
										argText += lower;
									} else {
										argText = (origArg[0] >>> 0).toString(16);
									}
								} else if (currArg < 0) {
									currArg = -currArg;
									argText = (currAbsArg - 1).toString(16);
									var buffer = [];
									for (var i = 0; i < argText.length; i++) {
										buffer.push((15 - parseInt(argText[i], 16)).toString(16));
									}
									argText = buffer.join("");
									while (argText.length < argSize * 2) argText = "f" + argText;
								} else {
									argText = currAbsArg.toString(16);
								}
								if (next == 88) {
									prefix = prefix.toUpperCase();
									argText = argText.toUpperCase();
								}
							} else if (next == 112) {
								if (currAbsArg === 0) {
									argText = "(nil)";
								} else {
									prefix = "0x";
									argText = currAbsArg.toString(16);
								}
							}
							if (precisionSet) {
								while (argText.length < precision) {
									argText = "0" + argText;
								}
							}
							if (currArg >= 0) {
								if (flagAlwaysSigned) {
									prefix = "+" + prefix;
								} else if (flagPadSign) {
									prefix = " " + prefix;
								}
							}
							if (argText.charAt(0) == "-") {
								prefix = "-" + prefix;
								argText = argText.substr(1);
							}
							while (prefix.length + argText.length < width) {
								if (flagLeftAlign) {
									argText += " ";
								} else {
									if (flagZeroPad) {
										argText = "0" + argText;
									} else {
										prefix = " " + prefix;
									}
								}
							}
							argText = prefix + argText;
							argText.split("").forEach(function (chr) {
								ret.push(chr.charCodeAt(0));
							});
							break;
						}
						;

					case "f":
					case "F":
					case "e":
					case "E":
					case "g":
					case "G":
						{
							var currArg = getNextArg("double");
							var argText;
							if (isNaN(currArg)) {
								argText = "nan";
								flagZeroPad = false;
							} else if (!isFinite(currArg)) {
								argText = (currArg < 0 ? "-" : "") + "inf";
								flagZeroPad = false;
							} else {
								var isGeneral = false;
								var effectivePrecision = Math.min(precision, 20);
								if (next == 103 || next == 71) {
									isGeneral = true;
									precision = precision || 1;
									var exponent = parseInt(currArg.toExponential(effectivePrecision).split("e")[1], 10);
									if (precision > exponent && exponent >= -4) {
										next = (next == 103 ? "f" : "F").charCodeAt(0);
										precision -= exponent + 1;
									} else {
										next = (next == 103 ? "e" : "E").charCodeAt(0);
										precision--;
									}
									effectivePrecision = Math.min(precision, 20);
								}
								if (next == 101 || next == 69) {
									argText = currArg.toExponential(effectivePrecision);
									if (/[eE][-+]\d$/.test(argText)) {
										argText = argText.slice(0, -1) + "0" + argText.slice(-1);
									}
								} else if (next == 102 || next == 70) {
									argText = currArg.toFixed(effectivePrecision);
									if (currArg === 0 && __reallyNegative(currArg)) {
										argText = "-" + argText;
									}
								}
								var parts = argText.split("e");
								if (isGeneral && !flagAlternative) {
									while (parts[0].length > 1 && parts[0].indexOf(".") != -1 && (parts[0].slice(-1) == "0" || parts[0].slice(-1) == ".")) {
										parts[0] = parts[0].slice(0, -1);
									}
								} else {
									if (flagAlternative && argText.indexOf(".") == -1) parts[0] += ".";
									while (precision > effectivePrecision++) parts[0] += "0";
								}
								argText = parts[0] + (parts.length > 1 ? "e" + parts[1] : "");
								if (next == 69) argText = argText.toUpperCase();
								if (currArg >= 0) {
									if (flagAlwaysSigned) {
										argText = "+" + argText;
									} else if (flagPadSign) {
										argText = " " + argText;
									}
								}
							}
							while (argText.length < width) {
								if (flagLeftAlign) {
									argText += " ";
								} else {
									if (flagZeroPad && (argText[0] == "-" || argText[0] == "+")) {
										argText = argText[0] + "0" + argText.slice(1);
									} else {
										argText = (flagZeroPad ? "0" : " ") + argText;
									}
								}
							}
							if (next < 97) argText = argText.toUpperCase();
							argText.split("").forEach(function (chr) {
								ret.push(chr.charCodeAt(0));
							});
							break;
						}
						;

					case "s":
						{
							var arg = getNextArg("i8*");
							var argLength = arg ? _strlen(arg) : "(null)".length;
							if (precisionSet) argLength = Math.min(argLength, precision);
							if (!flagLeftAlign) {
								while (argLength < width--) {
									ret.push(32);
								}
							}
							if (arg) {
								for (var i = 0; i < argLength; i++) {
									ret.push(HEAPU8[arg++ >> 0]);
								}
							} else {
								ret = ret.concat(intArrayFromString("(null)".substr(0, argLength), true));
							}
							if (flagLeftAlign) {
								while (argLength < width--) {
									ret.push(32);
								}
							}
							break;
						}
						;

					case "c":
						{
							if (flagLeftAlign) ret.push(getNextArg("i8"));
							while (--width > 0) {
								ret.push(32);
							}
							if (!flagLeftAlign) ret.push(getNextArg("i8"));
							break;
						}
						;

					case "n":
						{
							var ptr = getNextArg("i32*");
							HEAP32[ptr >> 2] = ret.length;
							break;
						}
						;

					case "%":
						{
							ret.push(curr);
							break;
						}
						;

					default:
						{
							for (var i = startTextIndex; i < textIndex + 2; i++) {
								ret.push(HEAP8[i >> 0]);
							}
						}
				}
				textIndex += 2;
			} else {
				ret.push(curr);
				textIndex += 1;
			}
		}
		return ret;
	}
	function _fprintf(stream, format, varargs) {
		var result = __formatString(format, varargs);
		var stack = Runtime.stackSave();
		var ret = _fwrite(allocate(result, "i8", ALLOC_STACK), 1, result.length, stream);
		Runtime.stackRestore(stack);
		return ret;
	}
	function _vfprintf(s, f, va_arg) {
		return _fprintf(s, f, HEAP32[va_arg >> 2]);
	}
	function ___cxa_begin_catch(ptr) {
		__ZSt18uncaught_exceptionv.uncaught_exception--;
		EXCEPTIONS.caught.push(ptr);
		EXCEPTIONS.addRef(EXCEPTIONS.deAdjust(ptr));
		return ptr;
	}
	function _emscripten_memcpy_big(dest, src, num) {
		HEAPU8.set(HEAPU8.subarray(src, src + num), dest);
		return dest;
	}
	Module["_memcpy"] = _memcpy;
	function _sbrk(bytes) {
		var self = _sbrk;
		if (!self.called) {
			DYNAMICTOP = alignMemoryPage(DYNAMICTOP);
			self.called = true;
			assert(Runtime.dynamicAlloc);
			self.alloc = Runtime.dynamicAlloc;
			Runtime.dynamicAlloc = function () {
				abort("cannot dynamically allocate, sbrk now has control");
			};
		}
		var ret = DYNAMICTOP;
		if (bytes != 0) {
			var success = self.alloc(bytes);
			if (!success) return -1 >>> 0;
		}
		return ret;
	}
	Module["_memmove"] = _memmove;
	function ___errno_location() {
		return ___errno_state;
	}
	var _BItoD = true;
	var _ceilf = Math_ceil;
	function __embind_register_memory_view(rawType, dataTypeIndex, name) {
		var typeMapping = [Int8Array, Uint8Array, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array];
		var TA = typeMapping[dataTypeIndex];
		function decodeMemoryView(handle) {
			handle = handle >> 2;
			var heap = HEAPU32;
			var size = heap[handle];
			var data = heap[handle + 1];
			return new TA(heap["buffer"], data, size);
		}
		name = readLatin1String(name);
		registerType(rawType, {
			name: name,
			fromWireType: decodeMemoryView,
			argPackAdvance: 8,
			readValueFromPointer: decodeMemoryView
		}, {
				ignoreDuplicateRegistrations: true
			});
	}
	function _time(ptr) {
		var ret = Date.now() / 1e3 | 0;
		if (ptr) {
			HEAP32[ptr >> 2] = ret;
		}
		return ret;
	}
	function __emval_incref(handle) {
		if (handle > 4) {
			emval_handle_array[handle].refcount += 1;
		}
	}
	function new_(constructor, argumentList) {
		if (!(constructor instanceof Function)) {
			throw new TypeError("new_ called with constructor type " + typeof constructor + " which is not a function");
		}
		var dummy = createNamedFunction(constructor.name || "unknownFunctionName", function () { });
		dummy.prototype = constructor.prototype;
		var obj = new dummy();
		var r = constructor.apply(obj, argumentList);
		return r instanceof Object ? r : obj;
	}
	function craftInvokerFunction(humanName, argTypes, classType, cppInvokerFunc, cppTargetFunc) {
		var argCount = argTypes.length;
		if (argCount < 2) {
			throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!");
		}
		var isClassMethodFunc = argTypes[1] !== null && classType !== null;
		var argsList = "";
		var argsListWired = "";
		for (var i = 0; i < argCount - 2; ++i) {
			argsList += (i !== 0 ? ", " : "") + "arg" + i;
			argsListWired += (i !== 0 ? ", " : "") + "arg" + i + "Wired";
		}
		var invokerFnBody = "return function " + makeLegalFunctionName(humanName) + "(" + argsList + ") {\n" + "if (arguments.length !== " + (argCount - 2) + ") {\n" + "throwBindingError('function " + humanName + " called with ' + arguments.length + ' arguments, expected " + (argCount - 2) + " args!');\n" + "}\n";
		var needsDestructorStack = false;
		for (var i = 1; i < argTypes.length; ++i) {
			if (argTypes[i] !== null && argTypes[i].destructorFunction === undefined) {
				needsDestructorStack = true;
				break;
			}
		}
		if (needsDestructorStack) {
			invokerFnBody += "var destructors = [];\n";
		}
		var dtorStack = needsDestructorStack ? "destructors" : "null";
		var args1 = ["throwBindingError", "invoker", "fn", "runDestructors", "retType", "classParam"];
		var args2 = [throwBindingError, cppInvokerFunc, cppTargetFunc, runDestructors, argTypes[0], argTypes[1]];
		if (isClassMethodFunc) {
			invokerFnBody += "var thisWired = classParam.toWireType(" + dtorStack + ", this);\n";
		}
		for (var i = 0; i < argCount - 2; ++i) {
			invokerFnBody += "var arg" + i + "Wired = argType" + i + ".toWireType(" + dtorStack + ", arg" + i + "); // " + argTypes[i + 2].name + "\n";
			args1.push("argType" + i);
			args2.push(argTypes[i + 2]);
		}
		if (isClassMethodFunc) {
			argsListWired = "thisWired" + (argsListWired.length > 0 ? ", " : "") + argsListWired;
		}
		var returns = argTypes[0].name !== "void";
		invokerFnBody += (returns ? "var rv = " : "") + "invoker(fn" + (argsListWired.length > 0 ? ", " : "") + argsListWired + ");\n";
		if (needsDestructorStack) {
			invokerFnBody += "runDestructors(destructors);\n";
		} else {
			for (var i = isClassMethodFunc ? 1 : 2; i < argTypes.length; ++i) {
				var paramName = i === 1 ? "thisWired" : "arg" + (i - 2) + "Wired";
				if (argTypes[i].destructorFunction !== null) {
					invokerFnBody += paramName + "_dtor(" + paramName + "); // " + argTypes[i].name + "\n";
					args1.push(paramName + "_dtor");
					args2.push(argTypes[i].destructorFunction);
				}
			}
		}
		if (returns) {
			invokerFnBody += "var ret = retType.fromWireType(rv);\n" + "return ret;\n";
		} else { }
		invokerFnBody += "}\n";
		args1.push(invokerFnBody);
		var invokerFunction = new_(Function, args1).apply(null, args2);
		return invokerFunction;
	}
	function __embind_register_class_function(rawClassType, methodName, argCount, rawArgTypesAddr, invokerSignature, rawInvoker, context, isPureVirtual) {
		var rawArgTypes = heap32VectorToArray(argCount, rawArgTypesAddr);
		methodName = readLatin1String(methodName);
		rawInvoker = requireFunction(invokerSignature, rawInvoker);
		whenDependentTypesAreResolved([], [rawClassType], function (classType) {
			classType = classType[0];
			var humanName = classType.name + "." + methodName;
			if (isPureVirtual) {
				classType.registeredClass.pureVirtualFunctions.push(methodName);
			}
			function unboundTypesHandler() {
				throwUnboundTypeError("Cannot call " + humanName + " due to unbound types", rawArgTypes);
			}
			var proto = classType.registeredClass.instancePrototype;
			var method = proto[methodName];
			if (undefined === method || undefined === method.overloadTable && method.className !== classType.name && method.argCount === argCount - 2) {
				unboundTypesHandler.argCount = argCount - 2;
				unboundTypesHandler.className = classType.name;
				proto[methodName] = unboundTypesHandler;
			} else {
				ensureOverloadTable(proto, methodName, humanName);
				proto[methodName].overloadTable[argCount - 2] = unboundTypesHandler;
			}
			whenDependentTypesAreResolved([], rawArgTypes, function (argTypes) {
				var memberFunction = craftInvokerFunction(humanName, argTypes, classType, rawInvoker, context);
				if (undefined === proto[methodName].overloadTable) {
					proto[methodName] = memberFunction;
				} else {
					proto[methodName].overloadTable[argCount - 2] = memberFunction;
				}
				return [];
			});
			return [];
		});
	}
	embind_init_charCodes();
	BindingError = Module["BindingError"] = extendError(Error, "BindingError");
	InternalError = Module["InternalError"] = extendError(Error, "InternalError");
	UnboundTypeError = Module["UnboundTypeError"] = extendError(Error, "UnboundTypeError");
	init_ClassHandle();
	init_RegisteredPointer();
	init_embind();
	_fputc.ret = allocate([0], "i8", ALLOC_STATIC);
	FS.staticInit();
	__ATINIT__.unshift({
		func: function () {
			if (!Module["noFSInit"] && !FS.init.initialized) FS.init();
		}
	});
	__ATMAIN__.push({
		func: function () {
			FS.ignorePermissions = false;
		}
	});
	__ATEXIT__.push({
		func: function () {
			FS.quit();
		}
	});
	Module["FS_createFolder"] = FS.createFolder;
	Module["FS_createPath"] = FS.createPath;
	Module["FS_createDataFile"] = FS.createDataFile;
	Module["FS_createPreloadedFile"] = FS.createPreloadedFile;
	Module["FS_createLazyFile"] = FS.createLazyFile;
	Module["FS_createLink"] = FS.createLink;
	Module["FS_createDevice"] = FS.createDevice;
	___errno_state = Runtime.staticAlloc(4);
	HEAP32[___errno_state >> 2] = 0;
	__ATINIT__.unshift({
		func: function () {
			TTY.init();
		}
	});
	__ATEXIT__.push({
		func: function () {
			TTY.shutdown();
		}
	});
	if (ENVIRONMENT_IS_NODE) {
		var fs = require("fs");
		var NODEJS_PATH = require("path");
		NODEFS.staticInit();
	}
	__ATINIT__.push({
		func: function () {
			SOCKFS.root = FS.mount(SOCKFS, {}, null);
		}
	});
	init_emval();
	Module["requestFullScreen"] = function Module_requestFullScreen(lockPointer, resizeCanvas, vrDevice) {
		Browser.requestFullScreen(lockPointer, resizeCanvas, vrDevice);
	};
	Module["requestAnimationFrame"] = function Module_requestAnimationFrame(func) {
		Browser.requestAnimationFrame(func);
	};
	Module["setCanvasSize"] = function Module_setCanvasSize(width, height, noUpdates) {
		Browser.setCanvasSize(width, height, noUpdates);
	};
	Module["pauseMainLoop"] = function Module_pauseMainLoop() {
		Browser.mainLoop.pause();
	};
	Module["resumeMainLoop"] = function Module_resumeMainLoop() {
		Browser.mainLoop.resume();
	};
	Module["getUserMedia"] = function Module_getUserMedia() {
		Browser.getUserMedia();
	};
	Module["createContext"] = function Module_createContext(canvas, useWebGL, setInModule, webGLContextAttributes) {
		return Browser.createContext(canvas, useWebGL, setInModule, webGLContextAttributes);
	};
	STACK_BASE = STACKTOP = Runtime.alignMemory(STATICTOP);
	staticSealed = true;
	STACK_MAX = STACK_BASE + TOTAL_STACK;
	DYNAMIC_BASE = DYNAMICTOP = Runtime.alignMemory(STACK_MAX);
	assert(DYNAMIC_BASE < TOTAL_MEMORY, "TOTAL_MEMORY not big enough for stack");
	var cttz_i8 = allocate([8, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 5, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 6, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 5, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 7, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 5, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 6, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 5, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0], "i8", ALLOC_DYNAMIC);
	function invoke_iiiii(index, a1, a2, a3, a4) {
		try {
			return Module["dynCall_iiiii"](index, a1, a2, a3, a4);
		} catch (e) {
			if (typeof e !== "number" && e !== "longjmp") throw e;
			asm["setThrew"](1, 0);
		}
	}
	function invoke_dii(index, a1, a2) {
		try {
			return Module["dynCall_dii"](index, a1, a2);
		} catch (e) {
			if (typeof e !== "number" && e !== "longjmp") throw e;
			asm["setThrew"](1, 0);
		}
	}
	function invoke_viiiii(index, a1, a2, a3, a4, a5) {
		try {
			Module["dynCall_viiiii"](index, a1, a2, a3, a4, a5);
		} catch (e) {
			if (typeof e !== "number" && e !== "longjmp") throw e;
			asm["setThrew"](1, 0);
		}
	}
	function invoke_i(index) {
		try {
			return Module["dynCall_i"](index);
		} catch (e) {
			if (typeof e !== "number" && e !== "longjmp") throw e;
			asm["setThrew"](1, 0);
		}
	}
	function invoke_vi(index, a1) {
		try {
			Module["dynCall_vi"](index, a1);
		} catch (e) {
			if (typeof e !== "number" && e !== "longjmp") throw e;
			asm["setThrew"](1, 0);
		}
	}
	function invoke_vii(index, a1, a2) {
		try {
			Module["dynCall_vii"](index, a1, a2);
		} catch (e) {
			if (typeof e !== "number" && e !== "longjmp") throw e;
			asm["setThrew"](1, 0);
		}
	}
	function invoke_ii(index, a1) {
		try {
			return Module["dynCall_ii"](index, a1);
		} catch (e) {
			if (typeof e !== "number" && e !== "longjmp") throw e;
			asm["setThrew"](1, 0);
		}
	}
	function invoke_iiii(index, a1, a2, a3) {
		try {
			return Module["dynCall_iiii"](index, a1, a2, a3);
		} catch (e) {
			if (typeof e !== "number" && e !== "longjmp") throw e;
			asm["setThrew"](1, 0);
		}
	}
	function invoke_viii(index, a1, a2, a3) {
		try {
			Module["dynCall_viii"](index, a1, a2, a3);
		} catch (e) {
			if (typeof e !== "number" && e !== "longjmp") throw e;
			asm["setThrew"](1, 0);
		}
	}
	function invoke_v(index) {
		try {
			Module["dynCall_v"](index);
		} catch (e) {
			if (typeof e !== "number" && e !== "longjmp") throw e;
			asm["setThrew"](1, 0);
		}
	}
	function invoke_viid(index, a1, a2, a3) {
		try {
			Module["dynCall_viid"](index, a1, a2, a3);
		} catch (e) {
			if (typeof e !== "number" && e !== "longjmp") throw e;
			asm["setThrew"](1, 0);
		}
	}
	function invoke_viiiiii(index, a1, a2, a3, a4, a5, a6) {
		try {
			Module["dynCall_viiiiii"](index, a1, a2, a3, a4, a5, a6);
		} catch (e) {
			if (typeof e !== "number" && e !== "longjmp") throw e;
			asm["setThrew"](1, 0);
		}
	}
	function invoke_iii(index, a1, a2) {
		try {
			return Module["dynCall_iii"](index, a1, a2);
		} catch (e) {
			if (typeof e !== "number" && e !== "longjmp") throw e;
			asm["setThrew"](1, 0);
		}
	}
	function invoke_viiii(index, a1, a2, a3, a4) {
		try {
			Module["dynCall_viiii"](index, a1, a2, a3, a4);
		} catch (e) {
			if (typeof e !== "number" && e !== "longjmp") throw e;
			asm["setThrew"](1, 0);
		}
	}
	Module.asmGlobalArg = {
		Math: Math,
		Int8Array: Int8Array,
		Int16Array: Int16Array,
		Int32Array: Int32Array,
		Uint8Array: Uint8Array,
		Uint16Array: Uint16Array,
		Uint32Array: Uint32Array,
		Float32Array: Float32Array,
		Float64Array: Float64Array,
		NaN: NaN,
		Infinity: Infinity
	};
	Module.asmLibraryArg = {
		abort: abort,
		assert: assert,
		invoke_iiiii: invoke_iiiii,
		invoke_dii: invoke_dii,
		invoke_viiiii: invoke_viiiii,
		invoke_i: invoke_i,
		invoke_vi: invoke_vi,
		invoke_vii: invoke_vii,
		invoke_ii: invoke_ii,
		invoke_iiii: invoke_iiii,
		invoke_viii: invoke_viii,
		invoke_v: invoke_v,
		invoke_viid: invoke_viid,
		invoke_viiiiii: invoke_viiiiii,
		invoke_iii: invoke_iii,
		invoke_viiii: invoke_viiii,
		floatReadValueFromPointer: floatReadValueFromPointer,
		simpleReadValueFromPointer: simpleReadValueFromPointer,
		RegisteredPointer_getPointee: RegisteredPointer_getPointee,
		throwInternalError: throwInternalError,
		get_first_emval: get_first_emval,
		getLiveInheritedInstances: getLiveInheritedInstances,
		___assert_fail: ___assert_fail,
		__ZSt18uncaught_exceptionv: __ZSt18uncaught_exceptionv,
		ClassHandle: ClassHandle,
		getShiftFromSize: getShiftFromSize,
		_emscripten_set_main_loop_timing: _emscripten_set_main_loop_timing,
		_ceilf: _ceilf,
		___cxa_begin_catch: ___cxa_begin_catch,
		_emscripten_memcpy_big: _emscripten_memcpy_big,
		runDestructor: runDestructor,
		_sysconf: _sysconf,
		throwInstanceAlreadyDeleted: throwInstanceAlreadyDeleted,
		__embind_register_std_string: __embind_register_std_string,
		init_RegisteredPointer: init_RegisteredPointer,
		ClassHandle_isAliasOf: ClassHandle_isAliasOf,
		flushPendingDeletes: flushPendingDeletes,
		makeClassHandle: makeClassHandle,
		_write: _write,
		whenDependentTypesAreResolved: whenDependentTypesAreResolved,
		__embind_register_class_constructor: __embind_register_class_constructor,
		init_ClassHandle: init_ClassHandle,
		ClassHandle_clone: ClassHandle_clone,
		_send: _send,
		RegisteredClass: RegisteredClass,
		___cxa_find_matching_catch: ___cxa_find_matching_catch,
		embind_init_charCodes: embind_init_charCodes,
		___setErrNo: ___setErrNo,
		__embind_register_bool: __embind_register_bool,
		___resumeException: ___resumeException,
		createNamedFunction: createNamedFunction,
		__embind_register_class_property: __embind_register_class_property,
		__embind_register_emval: __embind_register_emval,
		__emval_decref: __emval_decref,
		_pthread_once: _pthread_once,
		__embind_register_class: __embind_register_class,
		constNoSmartPtrRawPointerToWireType: constNoSmartPtrRawPointerToWireType,
		heap32VectorToArray: heap32VectorToArray,
		ClassHandle_delete: ClassHandle_delete,
		getInheritedInstanceCount: getInheritedInstanceCount,
		RegisteredPointer_destructor: RegisteredPointer_destructor,
		_fwrite: _fwrite,
		_time: _time,
		_fprintf: _fprintf,
		new_: new_,
		downcastPointer: downcastPointer,
		replacePublicSymbol: replacePublicSymbol,
		init_embind: init_embind,
		ClassHandle_deleteLater: ClassHandle_deleteLater,
		integerReadValueFromPointer: integerReadValueFromPointer,
		RegisteredPointer_deleteObject: RegisteredPointer_deleteObject,
		ClassHandle_isDeleted: ClassHandle_isDeleted,
		_vfprintf: _vfprintf,
		__embind_register_integer: __embind_register_integer,
		___cxa_allocate_exception: ___cxa_allocate_exception,
		__emval_take_value: __emval_take_value,
		_pwrite: _pwrite,
		_embind_repr: _embind_repr,
		_pthread_getspecific: _pthread_getspecific,
		__embind_register_class_function: __embind_register_class_function,
		throwUnboundTypeError: throwUnboundTypeError,
		craftInvokerFunction: craftInvokerFunction,
		runDestructors: runDestructors,
		requireRegisteredType: requireRegisteredType,
		makeLegalFunctionName: makeLegalFunctionName,
		_pthread_key_create: _pthread_key_create,
		upcastPointer: upcastPointer,
		init_emval: init_emval,
		shallowCopyInternalPointer: shallowCopyInternalPointer,
		nonConstNoSmartPtrRawPointerToWireType: nonConstNoSmartPtrRawPointerToWireType,
		_fputc: _fputc,
		_abort: _abort,
		throwBindingError: throwBindingError,
		getTypeName: getTypeName,
		validateThis: validateThis,
		exposePublicSymbol: exposePublicSymbol,
		RegisteredPointer_fromWireType: RegisteredPointer_fromWireType,
		__embind_register_memory_view: __embind_register_memory_view,
		getInheritedInstance: getInheritedInstance,
		setDelayFunction: setDelayFunction,
		extendError: extendError,
		ensureOverloadTable: ensureOverloadTable,
		__embind_register_void: __embind_register_void,
		_fflush: _fflush,
		__reallyNegative: __reallyNegative,
		__emval_register: __emval_register,
		__embind_register_std_wstring: __embind_register_std_wstring,
		_fileno: _fileno,
		__emval_incref: __emval_incref,
		RegisteredPointer: RegisteredPointer,
		readLatin1String: readLatin1String,
		getBasestPointer: getBasestPointer,
		_mkport: _mkport,
		__embind_register_float: __embind_register_float,
		_sbrk: _sbrk,
		_emscripten_set_main_loop: _emscripten_set_main_loop,
		___errno_location: ___errno_location,
		_pthread_setspecific: _pthread_setspecific,
		genericPointerToWireType: genericPointerToWireType,
		registerType: registerType,
		___cxa_throw: ___cxa_throw,
		count_emval_handles: count_emval_handles,
		requireFunction: requireFunction,
		__formatString: __formatString,
		_sqrt: _sqrt,
		STACKTOP: STACKTOP,
		STACK_MAX: STACK_MAX,
		tempDoublePtr: tempDoublePtr,
		ABORT: ABORT,
		cttz_i8: cttz_i8,
		_stderr: _stderr
	};
	var asm = function (global, env, buffer) {
		"use asm";
		var a = new global.Int8Array(buffer);
		var b = new global.Int16Array(buffer);
		var c = new global.Int32Array(buffer);
		var d = new global.Uint8Array(buffer);
		var e = new global.Uint16Array(buffer);
		var f = new global.Uint32Array(buffer);
		var g = new global.Float32Array(buffer);
		var h = new global.Float64Array(buffer);
		var i = env.STACKTOP | 0;
		var j = env.STACK_MAX | 0;
		var k = env.tempDoublePtr | 0;
		var l = env.ABORT | 0;
		var m = env.cttz_i8 | 0;
		var n = env._stderr | 0;
		var o = 0;
		var p = 0;
		var q = 0;
		var r = 0;
		var s = global.NaN, t = global.Infinity;
		var u = 0, v = 0, w = 0, x = 0, y = 0, z = 0, A = 0, B = 0, C = 0;
		var D = 0;
		var E = 0;
		var F = 0;
		var G = 0;
		var H = 0;
		var I = 0;
		var J = 0;
		var K = 0;
		var L = 0;
		var M = 0;
		var N = global.Math.floor;
		var O = global.Math.abs;
		var P = global.Math.sqrt;
		var Q = global.Math.pow;
		var R = global.Math.cos;
		var S = global.Math.sin;
		var T = global.Math.tan;
		var U = global.Math.acos;
		var V = global.Math.asin;
		var W = global.Math.atan;
		var X = global.Math.atan2;
		var Y = global.Math.exp;
		var Z = global.Math.log;
		var _ = global.Math.ceil;
		var $ = global.Math.imul;
		var aa = global.Math.min;
		var ba = global.Math.clz32;
		var ca = env.abort;
		var da = env.assert;
		var ea = env.invoke_iiiii;
		var fa = env.invoke_dii;
		var ga = env.invoke_viiiii;
		var ha = env.invoke_i;
		var ia = env.invoke_vi;
		var ja = env.invoke_vii;
		var ka = env.invoke_ii;
		var la = env.invoke_iiii;
		var ma = env.invoke_viii;
		var na = env.invoke_v;
		var oa = env.invoke_viid;
		var pa = env.invoke_viiiiii;
		var qa = env.invoke_iii;
		var ra = env.invoke_viiii;
		var sa = env.floatReadValueFromPointer;
		var ta = env.simpleReadValueFromPointer;
		var ua = env.RegisteredPointer_getPointee;
		var va = env.throwInternalError;
		var wa = env.get_first_emval;
		var xa = env.getLiveInheritedInstances;
		var ya = env.___assert_fail;
		var za = env.__ZSt18uncaught_exceptionv;
		var Aa = env.ClassHandle;
		var Ba = env.getShiftFromSize;
		var Ca = env._emscripten_set_main_loop_timing;
		var Da = env._ceilf;
		var Ea = env.___cxa_begin_catch;
		var Fa = env._emscripten_memcpy_big;
		var Ga = env.runDestructor;
		var Ha = env._sysconf;
		var Ia = env.throwInstanceAlreadyDeleted;
		var Ja = env.__embind_register_std_string;
		var Ka = env.init_RegisteredPointer;
		var La = env.ClassHandle_isAliasOf;
		var Ma = env.flushPendingDeletes;
		var Na = env.makeClassHandle;
		var Oa = env._write;
		var Pa = env.whenDependentTypesAreResolved;
		var Qa = env.__embind_register_class_constructor;
		var Ra = env.init_ClassHandle;
		var Sa = env.ClassHandle_clone;
		var Ta = env._send;
		var Ua = env.RegisteredClass;
		var Va = env.___cxa_find_matching_catch;
		var Wa = env.embind_init_charCodes;
		var Xa = env.___setErrNo;
		var Ya = env.__embind_register_bool;
		var Za = env.___resumeException;
		var _a = env.createNamedFunction;
		var $a = env.__embind_register_class_property;
		var ab = env.__embind_register_emval;
		var bb = env.__emval_decref;
		var cb = env._pthread_once;
		var db = env.__embind_register_class;
		var eb = env.constNoSmartPtrRawPointerToWireType;
		var fb = env.heap32VectorToArray;
		var gb = env.ClassHandle_delete;
		var hb = env.getInheritedInstanceCount;
		var ib = env.RegisteredPointer_destructor;
		var jb = env._fwrite;
		var kb = env._time;
		var lb = env._fprintf;
		var mb = env.new_;
		var nb = env.downcastPointer;
		var ob = env.replacePublicSymbol;
		var pb = env.init_embind;
		var qb = env.ClassHandle_deleteLater;
		var rb = env.integerReadValueFromPointer;
		var sb = env.RegisteredPointer_deleteObject;
		var tb = env.ClassHandle_isDeleted;
		var ub = env._vfprintf;
		var vb = env.__embind_register_integer;
		var wb = env.___cxa_allocate_exception;
		var xb = env.__emval_take_value;
		var yb = env._pwrite;
		var zb = env._embind_repr;
		var Ab = env._pthread_getspecific;
		var Bb = env.__embind_register_class_function;
		var Cb = env.throwUnboundTypeError;
		var Db = env.craftInvokerFunction;
		var Eb = env.runDestructors;
		var Fb = env.requireRegisteredType;
		var Gb = env.makeLegalFunctionName;
		var Hb = env._pthread_key_create;
		var Ib = env.upcastPointer;
		var Jb = env.init_emval;
		var Kb = env.shallowCopyInternalPointer;
		var Lb = env.nonConstNoSmartPtrRawPointerToWireType;
		var Mb = env._fputc;
		var Nb = env._abort;
		var Ob = env.throwBindingError;
		var Pb = env.getTypeName;
		var Qb = env.validateThis;
		var Rb = env.exposePublicSymbol;
		var Sb = env.RegisteredPointer_fromWireType;
		var Tb = env.__embind_register_memory_view;
		var Ub = env.getInheritedInstance;
		var Vb = env.setDelayFunction;
		var Wb = env.extendError;
		var Xb = env.ensureOverloadTable;
		var Yb = env.__embind_register_void;
		var Zb = env._fflush;
		var _b = env.__reallyNegative;
		var $b = env.__emval_register;
		var ac = env.__embind_register_std_wstring;
		var bc = env._fileno;
		var cc = env.__emval_incref;
		var dc = env.RegisteredPointer;
		var ec = env.readLatin1String;
		var fc = env.getBasestPointer;
		var gc = env._mkport;
		var hc = env.__embind_register_float;
		var ic = env._sbrk;
		var jc = env._emscripten_set_main_loop;
		var kc = env.___errno_location;
		var lc = env._pthread_setspecific;
		var mc = env.genericPointerToWireType;
		var nc = env.registerType;
		var oc = env.___cxa_throw;
		var pc = env.count_emval_handles;
		var qc = env.requireFunction;
		var rc = env.__formatString;
		var sc = env._sqrt;
		var tc = 0;
		function Ic(a) {
			a = a | 0;
			var b = 0;
			b = i;
			i = i + a | 0;
			i = i + 15 & -16;
			return b | 0;
		}
		function Jc() {
			return i | 0;
		}
		function Kc(a) {
			a = a | 0;
			i = a;
		}
		function Lc(a, b) {
			a = a | 0;
			b = b | 0;
			if (!o) {
				o = a;
				p = b;
			}
		}
		function Mc(b) {
			b = b | 0;
			a[k >> 0] = a[b >> 0];
			a[k + 1 >> 0] = a[b + 1 >> 0];
			a[k + 2 >> 0] = a[b + 2 >> 0];
			a[k + 3 >> 0] = a[b + 3 >> 0];
		}
		function Nc(b) {
			b = b | 0;
			a[k >> 0] = a[b >> 0];
			a[k + 1 >> 0] = a[b + 1 >> 0];
			a[k + 2 >> 0] = a[b + 2 >> 0];
			a[k + 3 >> 0] = a[b + 3 >> 0];
			a[k + 4 >> 0] = a[b + 4 >> 0];
			a[k + 5 >> 0] = a[b + 5 >> 0];
			a[k + 6 >> 0] = a[b + 6 >> 0];
			a[k + 7 >> 0] = a[b + 7 >> 0];
		}
		function Oc(a) {
			a = a | 0;
			D = a;
		}
		function Pc() {
			return D | 0;
		}
		function Qc(a) {
			a = a | 0;
			var b = 0, d = 0;
			a = i;
			i = i + 16 | 0;
			db(2120, 2472, 2440, 0, 2416, 2, 536, 0, 536, 0, 8, 2408, 11);
			b = bg(4) | 0;
			c[b >> 2] = 0;
			d = bg(4) | 0;
			c[d >> 2] = 0;
			$a(2120, 16, 5408, 2400, 1, b | 0, 5408, 2392, 1, d | 0);
			d = bg(4) | 0;
			c[d >> 2] = 8;
			b = bg(4) | 0;
			c[b >> 2] = 8;
			$a(2120, 24, 5408, 2400, 1, d | 0, 5408, 2392, 1, b | 0);
			b = bg(4) | 0;
			c[b >> 2] = 16;
			d = bg(4) | 0;
			c[d >> 2] = 16;
			$a(2120, 32, 5232, 2384, 1, b | 0, 5232, 2376, 1, d | 0);
			Yc(a + 2 | 0, 48);
			db(1736, 2072, 2048, 0, 2032, 3, 536, 0, 536, 0, 64, 2024, 12);
			d = bg(4) | 0;
			c[d >> 2] = 0;
			b = bg(4) | 0;
			c[b >> 2] = 0;
			$a(1736, 72, 5328, 2016, 2, d | 0, 5328, 2008, 2, b | 0);
			b = bg(4) | 0;
			c[b >> 2] = 4;
			d = bg(4) | 0;
			c[d >> 2] = 4;
			$a(1736, 88, 5328, 2016, 2, b | 0, 5328, 2008, 2, d | 0);
			d = bg(4) | 0;
			c[d >> 2] = 8;
			b = bg(4) | 0;
			c[b >> 2] = 8;
			$a(1736, 104, 5328, 2016, 2, d | 0, 5328, 2008, 2, b | 0);
			b = bg(4) | 0;
			c[b >> 2] = 12;
			d = bg(4) | 0;
			c[d >> 2] = 12;
			$a(1736, 120, 5232, 2e3, 3, b | 0, 5232, 1992, 3, d | 0);
			d = bg(4) | 0;
			c[d >> 2] = 13;
			b = bg(4) | 0;
			c[b >> 2] = 13;
			$a(1736, 136, 5232, 2e3, 3, d | 0, 5232, 1992, 3, b | 0);
			dd(a + 1 | 0, 152);
			db(1320, 1688, 1664, 0, 1648, 4, 536, 0, 536, 0, 168, 1640, 13);
			b = bg(4) | 0;
			c[b >> 2] = 0;
			d = bg(4) | 0;
			c[d >> 2] = 0;
			$a(1320, 176, 5328, 1632, 4, b | 0, 5328, 1624, 4, d | 0);
			d = bg(4) | 0;
			c[d >> 2] = 4;
			b = bg(4) | 0;
			c[b >> 2] = 4;
			$a(1320, 192, 5328, 1632, 4, d | 0, 5328, 1624, 4, b | 0);
			b = bg(4) | 0;
			c[b >> 2] = 8;
			d = bg(4) | 0;
			c[d >> 2] = 8;
			$a(1320, 208, 5232, 1616, 5, b | 0, 5232, 1608, 5, d | 0);
			kd(a, 224);
			db(376, 1176, 1224, 0, 1200, 5, 536, 0, 536, 0, 240, 1192, 14);
			Qa(376, 1, 1152, 1144, 6, 1);
			d = bg(4) | 0;
			c[d >> 2] = 0;
			b = bg(4) | 0;
			c[b >> 2] = 0;
			$a(376, 248, 1120, 984, 6, d | 0, 1120, 976, 6, b | 0);
			b = bg(4) | 0;
			c[b >> 2] = 12;
			d = bg(4) | 0;
			c[d >> 2] = 12;
			$a(376, 264, 952, 816, 7, b | 0, 952, 808, 7, d | 0);
			d = bg(4) | 0;
			c[d >> 2] = 24;
			b = bg(4) | 0;
			c[b >> 2] = 24;
			$a(376, 272, 784, 600, 8, d | 0, 784, 592, 8, b | 0);
			i = a;
			return;
		}
		function Rc(a) {
			a = a | 0;
			db(432, 440, 576, 0, 544, 7, 536, 0, 536, 0, 280, 528, 15);
			Qa(432, 1, 520, 512, 8, 2);
			a = bg(8) | 0;
			c[a >> 2] = 9;
			c[a + 4 >> 2] = 0;
			Bb(432, 304, 4, 496, 488, 4, a | 0, 0);
			a = bg(8) | 0;
			c[a >> 2] = 4;
			c[a + 4 >> 2] = 0;
			Bb(432, 320, 6, 464, 456, 4, a | 0, 0);
			a = bg(8) | 0;
			c[a >> 2] = 1;
			c[a + 4 >> 2] = 0;
			Bb(432, 336, 2, 360, 352, 9, a | 0, 0);
			return;
		}
		function Sc(a) {
			a = a | 0;
			return 2120;
		}
		function Tc(a) {
			a = a | 0;
			if (!a) return;
			cg(a);
			return;
		}
		function Uc(a, b) {
			a = a | 0;
			b = b | 0;
			return + +h[b + (c[a >> 2] | 0) >> 3];
		}
		function Vc(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = +d;
			h[b + (c[a >> 2] | 0) >> 3] = d;
			return;
		}
		function Wc(b, d) {
			b = b | 0;
			d = d | 0;
			return (a[d + (c[b >> 2] | 0) >> 0] | 0) != 0 | 0;
		}
		function Xc(b, d, e) {
			b = b | 0;
			d = d | 0;
			e = e | 0;
			a[d + (c[b >> 2] | 0) >> 0] = e & 1;
			return;
		}
		function Yc(a, b) {
			a = a | 0;
			b = b | 0;
			db(1120, 2304, 2216, 0, 2368, 9, 536, 0, 536, 0, b | 0, 2360, 16);
			Qa(1120, 1, 2352, 2344, 10, 3);
			a = bg(8) | 0;
			c[a >> 2] = 2;
			c[a + 4 >> 2] = 0;
			Bb(1120, 1240, 3, 2328, 2320, 10, a | 0, 0);
			a = bg(8) | 0;
			c[a >> 2] = 11;
			c[a + 4 >> 2] = 0;
			Bb(1120, 1256, 4, 2240, 2232, 5, a | 0, 0);
			a = bg(8) | 0;
			c[a >> 2] = 11;
			c[a + 4 >> 2] = 0;
			Bb(1120, 1264, 2, 2160, 2152, 10, a | 0, 0);
			a = bg(4) | 0;
			c[a >> 2] = 12;
			Bb(1120, 1272, 3, 2136, 2128, 4, a | 0, 0);
			a = bg(4) | 0;
			c[a >> 2] = 5;
			Bb(1120, 1280, 4, 2096, 2088, 1, a | 0, 0);
			return;
		}
		function Zc(a) {
			a = a | 0;
			return 1736;
		}
		function _c(a) {
			a = a | 0;
			if (!a) return;
			cg(a);
			return;
		}
		function $c(a, b) {
			a = a | 0;
			b = b | 0;
			return c[b + (c[a >> 2] | 0) >> 2] | 0;
		}
		function ad(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			c[b + (c[a >> 2] | 0) >> 2] = d;
			return;
		}
		function bd(b, d) {
			b = b | 0;
			d = d | 0;
			return (a[d + (c[b >> 2] | 0) >> 0] | 0) != 0 | 0;
		}
		function cd(b, d, e) {
			b = b | 0;
			d = d | 0;
			e = e | 0;
			a[d + (c[b >> 2] | 0) >> 0] = e & 1;
			return;
		}
		function dd(a, b) {
			a = a | 0;
			b = b | 0;
			db(952, 1920, 1832, 0, 1984, 12, 536, 0, 536, 0, b | 0, 1976, 17);
			Qa(952, 1, 1968, 1960, 13, 4);
			a = bg(8) | 0;
			c[a >> 2] = 3;
			c[a + 4 >> 2] = 0;
			Bb(952, 1240, 3, 1944, 1936, 13, a | 0, 0);
			a = bg(8) | 0;
			c[a >> 2] = 14;
			c[a + 4 >> 2] = 0;
			Bb(952, 1256, 4, 1856, 1848, 6, a | 0, 0);
			a = bg(8) | 0;
			c[a >> 2] = 14;
			c[a + 4 >> 2] = 0;
			Bb(952, 1264, 2, 1776, 1768, 11, a | 0, 0);
			a = bg(4) | 0;
			c[a >> 2] = 15;
			Bb(952, 1272, 3, 1752, 1744, 6, a | 0, 0);
			a = bg(4) | 0;
			c[a >> 2] = 7;
			Bb(952, 1280, 4, 1712, 1704, 2, a | 0, 0);
			return;
		}
		function ed(a) {
			a = a | 0;
			return 1320;
		}
		function fd(a) {
			a = a | 0;
			if (!a) return;
			cg(a);
			return;
		}
		function gd(a, b) {
			a = a | 0;
			b = b | 0;
			return c[b + (c[a >> 2] | 0) >> 2] | 0;
		}
		function hd(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			c[b + (c[a >> 2] | 0) >> 2] = d;
			return;
		}
		function id(b, d) {
			b = b | 0;
			d = d | 0;
			return (a[d + (c[b >> 2] | 0) >> 0] | 0) != 0 | 0;
		}
		function jd(b, d, e) {
			b = b | 0;
			d = d | 0;
			e = e | 0;
			a[d + (c[b >> 2] | 0) >> 0] = e & 1;
			return;
		}
		function kd(a, b) {
			a = a | 0;
			b = b | 0;
			db(784, 1536, 1448, 0, 1600, 15, 536, 0, 536, 0, b | 0, 1592, 18);
			Qa(784, 1, 1584, 1576, 16, 5);
			a = bg(8) | 0;
			c[a >> 2] = 4;
			c[a + 4 >> 2] = 0;
			Bb(784, 1240, 3, 1560, 1552, 16, a | 0, 0);
			a = bg(8) | 0;
			c[a >> 2] = 17;
			c[a + 4 >> 2] = 0;
			Bb(784, 1256, 4, 1472, 1464, 7, a | 0, 0);
			a = bg(8) | 0;
			c[a >> 2] = 17;
			c[a + 4 >> 2] = 0;
			Bb(784, 1264, 2, 1392, 1384, 12, a | 0, 0);
			a = bg(4) | 0;
			c[a >> 2] = 18;
			Bb(784, 1272, 3, 1336, 1328, 8, a | 0, 0);
			a = bg(4) | 0;
			c[a >> 2] = 9;
			Bb(784, 1280, 4, 1296, 1288, 3, a | 0, 0);
			return;
		}
		function ld(a) {
			a = a | 0;
			return 376;
		}
		function md(a) {
			a = a | 0;
			var b = 0, d = 0, e = 0, f = 0;
			if (!a) return;
			f = c[a + 24 >> 2] | 0;
			e = f;
			if (f) {
				d = a + 28 | 0;
				b = c[d >> 2] | 0;
				if ((b | 0) != (f | 0)) c[d >> 2] = b + (~(((b + -12 - e | 0) >>> 0) / 12 | 0) * 12 | 0);
				cg(f);
			}
			b = c[a + 12 >> 2] | 0;
			d = b;
			if (b) {
				e = a + 16 | 0;
				f = c[e >> 2] | 0;
				if ((f | 0) != (b | 0)) c[e >> 2] = f + (~((f + -16 - d | 0) >>> 4) << 4);
				cg(b);
			}
			f = c[a >> 2] | 0;
			e = f;
			if (f) {
				d = a + 4 | 0;
				b = c[d >> 2] | 0;
				if ((b | 0) != (f | 0)) c[d >> 2] = b + (~(((b + -24 - e | 0) >>> 0) / 24 | 0) * 24 | 0);
				cg(f);
			}
			cg(a);
			return;
		}
		function nd(a) {
			a = a | 0;
			return xc[a & 7]() | 0;
		}
		function od() {
			var a = 0, b = 0, d = 0;
			a = bg(36) | 0;
			b = a + 0 | 0;
			d = b + 36 | 0;
			do {
				c[b >> 2] = 0;
				b = b + 4 | 0;
			} while ((b | 0) < (d | 0));
			return a | 0;
		}
		function pd(a, b) {
			a = a | 0;
			b = b | 0;
			b = b + (c[a >> 2] | 0) | 0;
			a = bg(12) | 0;
			ue(a, b);
			return a | 0;
		}
		function qd(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			a = b + (c[a >> 2] | 0) | 0;
			if ((a | 0) == (d | 0)) return;
			ve(a, c[d >> 2] | 0, c[d + 4 >> 2] | 0);
			return;
		}
		function rd(a, b) {
			a = a | 0;
			b = b | 0;
			b = b + (c[a >> 2] | 0) | 0;
			a = bg(12) | 0;
			we(a, b);
			return a | 0;
		}
		function sd(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			a = b + (c[a >> 2] | 0) | 0;
			if ((a | 0) == (d | 0)) return;
			xe(a, c[d >> 2] | 0, c[d + 4 >> 2] | 0);
			return;
		}
		function td(a, b) {
			a = a | 0;
			b = b | 0;
			b = b + (c[a >> 2] | 0) | 0;
			a = bg(12) | 0;
			ye(a, b);
			return a | 0;
		}
		function ud(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			a = b + (c[a >> 2] | 0) | 0;
			if ((a | 0) == (d | 0)) return;
			ze(a, c[d >> 2] | 0, c[d + 4 >> 2] | 0);
			return;
		}
		function vd(a) {
			a = a | 0;
			return 432;
		}
		function wd(a) {
			a = a | 0;
			if (!a) return;
			Ae(a);
			cg(a);
			return;
		}
		function xd(a) {
			a = a | 0;
			return xc[a & 7]() | 0;
		}
		function yd() {
			var b = 0, d = 0, e = 0, f = 0, h = 0;
			f = i;
			i = i + 16 | 0;
			h = f;
			b = bg(2780) | 0;
			e = b + 52 | 0;
			Yg(b | 0, 0, 2776) | 0;
			c[e >> 2] = e;
			c[b + 56 >> 2] = e;
			c[b + 60 >> 2] = 0;
			a[h + 0 >> 0] = 0;
			a[h + 1 >> 0] = 0;
			a[h + 2 >> 0] = 0;
			e = b + 68 | 0;
			c[e >> 2] = 0;
			c[b + 72 >> 2] = 0;
			d = b + 76 | 0;
			a[d + 0 >> 0] = a[h + 0 >> 0] | 0;
			a[d + 1 >> 0] = a[h + 1 >> 0] | 0;
			a[d + 2 >> 0] = a[h + 2 >> 0] | 0;
			c[b + 64 >> 2] = e;
			e = b + 2740 | 0;
			d = b + 2756 | 0;
			c[e + 0 >> 2] = 0;
			c[e + 4 >> 2] = 0;
			c[e + 8 >> 2] = 0;
			c[e + 12 >> 2] = 0;
			e = b + 2696 | 0;
			h = e + 40 | 0;
			do {
				c[e >> 2] = 0;
				e = e + 4 | 0;
			} while ((e | 0) < (h | 0));
			g[d >> 2] = 1;
			d = b + 2760 | 0;
			c[d + 0 >> 2] = 0;
			c[d + 4 >> 2] = 0;
			c[d + 8 >> 2] = 0;
			c[d + 12 >> 2] = 0;
			g[b + 2776 >> 2] = 1;
			i = f;
			return b | 0;
		}
		function zd(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0;
			f = i;
			i = i + 32 | 0;
			e = f;
			c[e >> 2] = b;
			c[e + 4 >> 2] = d;
			c[e + 8 >> 2] = b;
			c[e + 12 >> 2] = d;
			c[e + 16 >> 2] = 0;
			c[e + 24 >> 2] = 0;
			d = a + 8 | 0;
			b = c[d >> 2] | 0;
			if (b >>> 0 >= (c[a + 12 >> 2] | 0) >>> 0) {
				Be(a + 4 | 0, e);
				e = c[d >> 2] | 0;
				b = a + 2696 | 0;
				d = c[b >> 2] | 0;
				e = e + -8 | 0;
				c[e >> 2] = d;
				d = d + 1 | 0;
				c[b >> 2] = d;
				i = f;
				return;
			}
			if (!b) b = 0; else {
				c[b + 0 >> 2] = c[e + 0 >> 2];
				c[b + 4 >> 2] = c[e + 4 >> 2];
				c[b + 8 >> 2] = c[e + 8 >> 2];
				c[b + 12 >> 2] = c[e + 12 >> 2];
				c[b + 16 >> 2] = c[e + 16 >> 2];
				c[b + 20 >> 2] = c[e + 20 >> 2];
				c[b + 24 >> 2] = c[e + 24 >> 2];
				b = c[d >> 2] | 0;
			}
			e = b + 28 | 0;
			c[d >> 2] = e;
			b = a + 2696 | 0;
			d = c[b >> 2] | 0;
			e = e + -8 | 0;
			c[e >> 2] = d;
			d = d + 1 | 0;
			c[b >> 2] = d;
			i = f;
			return;
		}
		function Ad(a, b, d, e) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			var f = 0, g = 0;
			f = c[a >> 2] | 0;
			g = c[a + 4 >> 2] | 0;
			a = b + (g >> 1) | 0;
			if (!(g & 1)) {
				b = f;
				Cc[b & 31](a, d, e);
				return;
			} else {
				b = c[(c[a >> 2] | 0) + f >> 2] | 0;
				Cc[b & 31](a, d, e);
				return;
			}
		}
		function Bd(a, b, d, e, f) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			var g = 0, h = 0, j = 0, k = 0, l = 0;
			g = i;
			i = i + 16 | 0;
			l = g + 12 | 0;
			k = g + 8 | 0;
			j = g + 4 | 0;
			h = g;
			c[l >> 2] = b;
			c[k >> 2] = d;
			c[j >> 2] = e;
			c[h >> 2] = f;
			Ce(a, l, k, j, h) | 0;
			i = g;
			return;
		}
		function Cd(a, b, d, e, f, g) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			g = g | 0;
			var h = 0, i = 0;
			h = c[a >> 2] | 0;
			i = c[a + 4 >> 2] | 0;
			a = b + (i >> 1) | 0;
			if (i & 1) h = c[(c[a >> 2] | 0) + h >> 2] | 0;
			wc[h & 7](a, d, e, f, g);
			return;
		}
		function Dd(b, d) {
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0, v = 0, w = 0, x = 0, y = 0, z = 0;
			z = i;
			i = i + 64 | 0;
			p = z + 56 | 0;
			q = z;
			r = z + 52 | 0;
			t = z + 40 | 0;
			y = z + 24 | 0;
			s = d + 2700 | 0;
			De(d, s);
			e = b + 0 | 0;
			f = e + 36 | 0;
			do {
				c[e >> 2] = 0;
				e = e + 4 | 0;
			} while ((e | 0) < (f | 0));
			k = d + 2716 | 0;
			j = d + 2712 | 0;
			f = c[j >> 2] | 0;
			if ((c[k >> 2] | 0) != (f | 0)) {
				g = d + 2740 | 0;
				e = q + 8 | 0;
				n = q + 16 | 0;
				m = b + 4 | 0;
				l = b + 8 | 0;
				o = 0;
				do {
					u = f + (o * 24 | 0) | 0;
					c[p >> 2] = u;
					c[(Ee(g, p) | 0) >> 2] = o;
					h[q >> 3] = +h[u >> 3];
					h[e >> 3] = +h[f + (o * 24 | 0) + 8 >> 3];
					a[n >> 0] = (c[f + (o * 24 | 0) + 16 >> 2] | 0) == 0 & 1;
					f = c[m >> 2] | 0;
					if ((f | 0) == (c[l >> 2] | 0)) Fe(b, q); else {
						if (!f) f = 0; else {
							c[f + 0 >> 2] = c[q + 0 >> 2];
							c[f + 4 >> 2] = c[q + 4 >> 2];
							c[f + 8 >> 2] = c[q + 8 >> 2];
							c[f + 12 >> 2] = c[q + 12 >> 2];
							c[f + 16 >> 2] = c[q + 16 >> 2];
							c[f + 20 >> 2] = c[q + 20 >> 2];
							f = c[m >> 2] | 0;
						}
						c[m >> 2] = f + 24;
					}
					o = o + 1 | 0;
					f = c[j >> 2] | 0;
				} while (o >>> 0 < (((c[k >> 2] | 0) - f | 0) / 24 | 0) >>> 0);
			}
			g = d + 2704 | 0;
			f = c[s >> 2] | 0;
			if ((c[g >> 2] | 0) != (f | 0)) {
				j = d + 2760 | 0;
				k = t + 4 | 0;
				l = t + 8 | 0;
				m = b + 28 | 0;
				n = b + 32 | 0;
				o = b + 24 | 0;
				e = 0;
				do {
					p = f + (e * 12 | 0) | 0;
					c[r >> 2] = p;
					c[(Ge(j, r) | 0) >> 2] = e;
					c[t >> 2] = c[p >> 2];
					f = c[f + (e * 12 | 0) + 8 >> 2] | 0;
					c[k >> 2] = f & 31;
					a[l >> 0] = (f & 24 | 0) == 0 & 1;
					f = c[m >> 2] | 0;
					if ((f | 0) == (c[n >> 2] | 0)) He(o, t); else {
						if (!f) f = 0; else {
							c[f + 0 >> 2] = c[t + 0 >> 2];
							c[f + 4 >> 2] = c[t + 4 >> 2];
							c[f + 8 >> 2] = c[t + 8 >> 2];
							f = c[m >> 2] | 0;
						}
						c[m >> 2] = f + 12;
					}
					e = e + 1 | 0;
					f = c[s >> 2] | 0;
				} while (e >>> 0 < (((c[g >> 2] | 0) - f | 0) / 12 | 0) >>> 0);
			}
			f = c[d + 2724 >> 2] | 0;
			m = c[d + 2728 >> 2] | 0;
			if ((f | 0) == (m | 0)) {
				i = z;
				return;
			}
			n = y + 4 | 0;
			p = y + 8 | 0;
			u = y + 12 | 0;
			v = y + 13 | 0;
			w = b + 16 | 0;
			x = b + 20 | 0;
			t = b + 12 | 0;
			s = d + 2764 | 0;
			r = d + 2760 | 0;
			l = d + 2744 | 0;
			b = d + 2740 | 0;
			d = f;
			do {
				k = c[d + 4 >> 2] | 0;
				a: do if (k) {
					o = $(k, 1540483477) | 0;
					o = ($(o >>> 24 ^ o, 1540483477) | 0) ^ 1866966612;
					o = $(o >>> 13 ^ o, 1540483477) | 0;
					o = o >>> 15 ^ o;
					e = c[l >> 2] | 0;
					if (e) {
						g = e + -1 | 0;
						j = (g & e | 0) == 0;
						if (j) q = g & o; else q = (o >>> 0) % (e >>> 0) | 0;
						f = c[(c[b >> 2] | 0) + (q << 2) >> 2] | 0;
						if (f) {
							do {
								f = c[f >> 2] | 0;
								if (!f) {
									f = -2;
									break a;
								}
								o = c[f + 4 >> 2] | 0;
								if (j) o = o & g; else o = (o >>> 0) % (e >>> 0) | 0;
								if ((o | 0) != (q | 0)) {
									f = -2;
									break a;
								}
							} while ((c[f + 8 >> 2] | 0) != (k | 0));
							f = c[f + 12 >> 2] | 0;
						} else f = -2;
					} else f = -2;
				} else f = -1; while (0);
				c[y >> 2] = f;
				e = c[(c[d + 8 >> 2] | 0) + 4 >> 2] | 0;
				b: do if (e) {
					o = $(e, 1540483477) | 0;
					o = ($(o >>> 24 ^ o, 1540483477) | 0) ^ 1866966612;
					o = $(o >>> 13 ^ o, 1540483477) | 0;
					o = o >>> 15 ^ o;
					g = c[l >> 2] | 0;
					if (g) {
						j = g + -1 | 0;
						k = (j & g | 0) == 0;
						if (k) q = j & o; else q = (o >>> 0) % (g >>> 0) | 0;
						f = c[(c[b >> 2] | 0) + (q << 2) >> 2] | 0;
						if (f) {
							do {
								f = c[f >> 2] | 0;
								if (!f) {
									f = -2;
									break b;
								}
								o = c[f + 4 >> 2] | 0;
								if (k) o = o & j; else o = (o >>> 0) % (g >>> 0) | 0;
								if ((o | 0) != (q | 0)) {
									f = -2;
									break b;
								}
							} while ((c[f + 8 >> 2] | 0) != (e | 0));
							f = c[f + 12 >> 2] | 0;
						} else f = -2;
					} else f = -2;
				} else f = -1; while (0);
				c[n >> 2] = f;
				e = c[d >> 2] | 0;
				c: do if (e) {
					o = $(e, 1540483477) | 0;
					o = ($(o >>> 24 ^ o, 1540483477) | 0) ^ 1866966612;
					o = $(o >>> 13 ^ o, 1540483477) | 0;
					o = o >>> 15 ^ o;
					g = c[s >> 2] | 0;
					if (g) {
						j = g + -1 | 0;
						k = (j & g | 0) == 0;
						if (k) q = j & o; else q = (o >>> 0) % (g >>> 0) | 0;
						f = c[(c[r >> 2] | 0) + (q << 2) >> 2] | 0;
						if (f) {
							do {
								f = c[f >> 2] | 0;
								if (!f) {
									f = -2;
									break c;
								}
								o = c[f + 4 >> 2] | 0;
								if (k) o = o & j; else o = (o >>> 0) % (g >>> 0) | 0;
								if ((o | 0) != (q | 0)) {
									f = -2;
									break c;
								}
							} while ((c[f + 8 >> 2] | 0) != (e | 0));
							f = c[f + 12 >> 2] | 0;
						} else f = -2;
					} else f = -2;
				} else f = -1; while (0);
				c[p >> 2] = f;
				f = c[d + 20 >> 2] | 0;
				a[u >> 0] = f >>> 1 & 1;
				a[v >> 0] = f & 1;
				f = c[w >> 2] | 0;
				if ((f | 0) == (c[x >> 2] | 0)) Ie(t, y); else {
					if (!f) f = 0; else {
						c[f + 0 >> 2] = c[y + 0 >> 2];
						c[f + 4 >> 2] = c[y + 4 >> 2];
						c[f + 8 >> 2] = c[y + 8 >> 2];
						c[f + 12 >> 2] = c[y + 12 >> 2];
						f = c[w >> 2] | 0;
					}
					c[w >> 2] = f + 16;
				}
				d = d + 24 | 0;
			} while ((d | 0) != (m | 0));
			i = z;
			return;
		}
		function Ed(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0, f = 0, g = 0;
			f = i;
			i = i + 48 | 0;
			e = f;
			d = c[a >> 2] | 0;
			g = c[a + 4 >> 2] | 0;
			a = b + (g >> 1) | 0;
			if (g & 1) d = c[(c[a >> 2] | 0) + d >> 2] | 0;
			zc[d & 7](e, a);
			d = bg(36) | 0;
			c[d >> 2] = c[e >> 2];
			a = e + 4 | 0;
			c[d + 4 >> 2] = c[a >> 2];
			b = e + 8 | 0;
			c[d + 8 >> 2] = c[b >> 2];
			c[b >> 2] = 0;
			c[a >> 2] = 0;
			c[e >> 2] = 0;
			a = e + 12 | 0;
			c[d + 12 >> 2] = c[a >> 2];
			b = e + 16 | 0;
			c[d + 16 >> 2] = c[b >> 2];
			g = e + 20 | 0;
			c[d + 20 >> 2] = c[g >> 2];
			c[g >> 2] = 0;
			c[b >> 2] = 0;
			c[a >> 2] = 0;
			c[d + 24 >> 2] = c[e + 24 >> 2];
			c[d + 28 >> 2] = c[e + 28 >> 2];
			c[d + 32 >> 2] = c[e + 32 >> 2];
			i = f;
			return d | 0;
		}
		function Fd() {
			Qc(0);
			Rc(0);
			return;
		}
		function Gd(a) {
			a = a | 0;
			return 1120;
		}
		function Hd(a) {
			a = a | 0;
			var b = 0, d = 0, e = 0, f = 0;
			if (!a) return;
			b = c[a >> 2] | 0;
			d = b;
			if (b) {
				e = a + 4 | 0;
				f = c[e >> 2] | 0;
				if ((f | 0) != (b | 0)) c[e >> 2] = f + (~(((f + -24 - d | 0) >>> 0) / 24 | 0) * 24 | 0);
				cg(b);
			}
			cg(a);
			return;
		}
		function Id(a) {
			a = a | 0;
			return xc[a & 7]() | 0;
		}
		function Jd() {
			var a = 0;
			a = bg(12) | 0;
			c[a >> 2] = 0;
			c[a + 4 >> 2] = 0;
			c[a + 8 >> 2] = 0;
			return a | 0;
		}
		function Kd(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0;
			e = a + 4 | 0;
			d = c[e >> 2] | 0;
			if ((d | 0) == (c[a + 8 >> 2] | 0)) {
				Fe(a, b);
				return;
			}
			if (!d) d = 0; else {
				c[d + 0 >> 2] = c[b + 0 >> 2];
				c[d + 4 >> 2] = c[b + 4 >> 2];
				c[d + 8 >> 2] = c[b + 8 >> 2];
				c[d + 12 >> 2] = c[b + 12 >> 2];
				c[d + 16 >> 2] = c[b + 16 >> 2];
				c[d + 20 >> 2] = c[b + 20 >> 2];
				d = c[e >> 2] | 0;
			}
			c[e >> 2] = d + 24;
			return;
		}
		function Ld(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0;
			e = c[a >> 2] | 0;
			f = c[a + 4 >> 2] | 0;
			a = b + (f >> 1) | 0;
			if (!(f & 1)) {
				b = e;
				zc[b & 7](a, d);
				return;
			} else {
				b = c[(c[a >> 2] | 0) + e >> 2] | 0;
				zc[b & 7](a, d);
				return;
			}
		}
		function Md(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, h = 0;
			g = a + 4 | 0;
			h = c[g >> 2] | 0;
			e = c[a >> 2] | 0;
			f = (h - e | 0) / 24 | 0;
			if (f >>> 0 < b >>> 0) {
				Je(a, b - f | 0, d);
				return;
			}
			if (f >>> 0 <= b >>> 0) return;
			e = e + (b * 24 | 0) | 0;
			if ((h | 0) == (e | 0)) return;
			c[g >> 2] = h + (~(((h + -24 - e | 0) >>> 0) / 24 | 0) * 24 | 0);
			return;
		}
		function Nd(a, b, d, e) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			var f = 0, g = 0;
			f = c[a >> 2] | 0;
			g = c[a + 4 >> 2] | 0;
			a = b + (g >> 1) | 0;
			if (!(g & 1)) {
				b = f;
				Cc[b & 31](a, d, e);
				return;
			} else {
				b = c[(c[a >> 2] | 0) + f >> 2] | 0;
				Cc[b & 31](a, d, e);
				return;
			}
		}
		function Od(a) {
			a = a | 0;
			return ((c[a + 4 >> 2] | 0) - (c[a >> 2] | 0) | 0) / 24 | 0 | 0;
		}
		function Pd(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0;
			d = c[a >> 2] | 0;
			e = c[a + 4 >> 2] | 0;
			a = b + (e >> 1) | 0;
			if (!(e & 1)) {
				b = d;
				a = Ac[b & 31](a) | 0;
				return a | 0;
			} else {
				b = c[(c[a >> 2] | 0) + d >> 2] | 0;
				a = Ac[b & 31](a) | 0;
				return a | 0;
			}
		}
		function Qd(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0;
			g = i;
			i = i + 16 | 0;
			f = g;
			e = c[b >> 2] | 0;
			if ((((c[b + 4 >> 2] | 0) - e | 0) / 24 | 0) >>> 0 > d >>> 0) {
				d = e + (d * 24 | 0) | 0;
				e = bg(24) | 0;
				c[e + 0 >> 2] = c[d + 0 >> 2];
				c[e + 4 >> 2] = c[d + 4 >> 2];
				c[e + 8 >> 2] = c[d + 8 >> 2];
				c[e + 12 >> 2] = c[d + 12 >> 2];
				c[e + 16 >> 2] = c[d + 16 >> 2];
				c[e + 20 >> 2] = c[d + 20 >> 2];
				c[f >> 2] = e;
				c[a >> 2] = xb(2120, f | 0) | 0;
				i = g;
				return;
			} else {
				c[a >> 2] = 1;
				i = g;
				return;
			}
		}
		function Rd(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0;
			e = i;
			i = i + 16 | 0;
			f = e;
			Cc[c[a >> 2] & 31](f, b, d);
			cc(c[f >> 2] | 0);
			d = c[f >> 2] | 0;
			bb(d | 0);
			i = e;
			return d | 0;
		}
		function Sd(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			b = (c[a >> 2] | 0) + (b * 24 | 0) | 0;
			c[b + 0 >> 2] = c[d + 0 >> 2];
			c[b + 4 >> 2] = c[d + 4 >> 2];
			c[b + 8 >> 2] = c[d + 8 >> 2];
			c[b + 12 >> 2] = c[d + 12 >> 2];
			c[b + 16 >> 2] = c[d + 16 >> 2];
			c[b + 20 >> 2] = c[d + 20 >> 2];
			return 1;
		}
		function Td(a, b, d, e) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			return Bc[c[a >> 2] & 15](b, d, e) | 0;
		}
		function Ud(a) {
			a = a | 0;
			return 952;
		}
		function Vd(a) {
			a = a | 0;
			var b = 0, d = 0, e = 0, f = 0;
			if (!a) return;
			b = c[a >> 2] | 0;
			d = b;
			if (b) {
				e = a + 4 | 0;
				f = c[e >> 2] | 0;
				if ((f | 0) != (b | 0)) c[e >> 2] = f + (~((f + -16 - d | 0) >>> 4) << 4);
				cg(b);
			}
			cg(a);
			return;
		}
		function Wd(a) {
			a = a | 0;
			return xc[a & 7]() | 0;
		}
		function Xd() {
			var a = 0;
			a = bg(12) | 0;
			c[a >> 2] = 0;
			c[a + 4 >> 2] = 0;
			c[a + 8 >> 2] = 0;
			return a | 0;
		}
		function Yd(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0;
			e = a + 4 | 0;
			d = c[e >> 2] | 0;
			if ((d | 0) == (c[a + 8 >> 2] | 0)) {
				Ie(a, b);
				return;
			}
			if (!d) d = 0; else {
				c[d + 0 >> 2] = c[b + 0 >> 2];
				c[d + 4 >> 2] = c[b + 4 >> 2];
				c[d + 8 >> 2] = c[b + 8 >> 2];
				c[d + 12 >> 2] = c[b + 12 >> 2];
				d = c[e >> 2] | 0;
			}
			c[e >> 2] = d + 16;
			return;
		}
		function Zd(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0;
			e = c[a >> 2] | 0;
			f = c[a + 4 >> 2] | 0;
			a = b + (f >> 1) | 0;
			if (!(f & 1)) {
				b = e;
				zc[b & 7](a, d);
				return;
			} else {
				b = c[(c[a >> 2] | 0) + e >> 2] | 0;
				zc[b & 7](a, d);
				return;
			}
		}
		function _d(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, h = 0;
			g = a + 4 | 0;
			h = c[g >> 2] | 0;
			e = c[a >> 2] | 0;
			f = h - e >> 4;
			if (f >>> 0 < b >>> 0) {
				Le(a, b - f | 0, d);
				return;
			}
			if (f >>> 0 <= b >>> 0) return;
			e = e + (b << 4) | 0;
			if ((h | 0) == (e | 0)) return;
			c[g >> 2] = h + (~((h + -16 - e | 0) >>> 4) << 4);
			return;
		}
		function $d(a, b, d, e) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			var f = 0, g = 0;
			f = c[a >> 2] | 0;
			g = c[a + 4 >> 2] | 0;
			a = b + (g >> 1) | 0;
			if (!(g & 1)) {
				b = f;
				Cc[b & 31](a, d, e);
				return;
			} else {
				b = c[(c[a >> 2] | 0) + f >> 2] | 0;
				Cc[b & 31](a, d, e);
				return;
			}
		}
		function ae(a) {
			a = a | 0;
			return (c[a + 4 >> 2] | 0) - (c[a >> 2] | 0) >> 4 | 0;
		}
		function be(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0;
			d = c[a >> 2] | 0;
			e = c[a + 4 >> 2] | 0;
			a = b + (e >> 1) | 0;
			if (!(e & 1)) {
				b = d;
				a = Ac[b & 31](a) | 0;
				return a | 0;
			} else {
				b = c[(c[a >> 2] | 0) + d >> 2] | 0;
				a = Ac[b & 31](a) | 0;
				return a | 0;
			}
		}
		function ce(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0;
			g = i;
			i = i + 16 | 0;
			f = g;
			e = c[b >> 2] | 0;
			if ((c[b + 4 >> 2] | 0) - e >> 4 >>> 0 > d >>> 0) {
				d = e + (d << 4) | 0;
				e = bg(16) | 0;
				c[e + 0 >> 2] = c[d + 0 >> 2];
				c[e + 4 >> 2] = c[d + 4 >> 2];
				c[e + 8 >> 2] = c[d + 8 >> 2];
				c[e + 12 >> 2] = c[d + 12 >> 2];
				c[f >> 2] = e;
				c[a >> 2] = xb(1736, f | 0) | 0;
				i = g;
				return;
			} else {
				c[a >> 2] = 1;
				i = g;
				return;
			}
		}
		function de(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0;
			e = i;
			i = i + 16 | 0;
			f = e;
			Cc[c[a >> 2] & 31](f, b, d);
			cc(c[f >> 2] | 0);
			d = c[f >> 2] | 0;
			bb(d | 0);
			i = e;
			return d | 0;
		}
		function ee(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			b = (c[a >> 2] | 0) + (b << 4) | 0;
			c[b + 0 >> 2] = c[d + 0 >> 2];
			c[b + 4 >> 2] = c[d + 4 >> 2];
			c[b + 8 >> 2] = c[d + 8 >> 2];
			c[b + 12 >> 2] = c[d + 12 >> 2];
			return 1;
		}
		function fe(a, b, d, e) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			return Bc[c[a >> 2] & 15](b, d, e) | 0;
		}
		function ge(a) {
			a = a | 0;
			return 784;
		}
		function he(a) {
			a = a | 0;
			var b = 0, d = 0, e = 0, f = 0;
			if (!a) return;
			b = c[a >> 2] | 0;
			d = b;
			if (b) {
				e = a + 4 | 0;
				f = c[e >> 2] | 0;
				if ((f | 0) != (b | 0)) c[e >> 2] = f + (~(((f + -12 - d | 0) >>> 0) / 12 | 0) * 12 | 0);
				cg(b);
			}
			cg(a);
			return;
		}
		function ie(a) {
			a = a | 0;
			return xc[a & 7]() | 0;
		}
		function je() {
			var a = 0;
			a = bg(12) | 0;
			c[a >> 2] = 0;
			c[a + 4 >> 2] = 0;
			c[a + 8 >> 2] = 0;
			return a | 0;
		}
		function ke(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0;
			e = a + 4 | 0;
			d = c[e >> 2] | 0;
			if ((d | 0) == (c[a + 8 >> 2] | 0)) {
				He(a, b);
				return;
			}
			if (!d) d = 0; else {
				c[d + 0 >> 2] = c[b + 0 >> 2];
				c[d + 4 >> 2] = c[b + 4 >> 2];
				c[d + 8 >> 2] = c[b + 8 >> 2];
				d = c[e >> 2] | 0;
			}
			c[e >> 2] = d + 12;
			return;
		}
		function le(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0;
			e = c[a >> 2] | 0;
			f = c[a + 4 >> 2] | 0;
			a = b + (f >> 1) | 0;
			if (!(f & 1)) {
				b = e;
				zc[b & 7](a, d);
				return;
			} else {
				b = c[(c[a >> 2] | 0) + e >> 2] | 0;
				zc[b & 7](a, d);
				return;
			}
		}
		function me(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, h = 0;
			g = a + 4 | 0;
			h = c[g >> 2] | 0;
			e = c[a >> 2] | 0;
			f = (h - e | 0) / 12 | 0;
			if (f >>> 0 < b >>> 0) {
				Me(a, b - f | 0, d);
				return;
			}
			if (f >>> 0 <= b >>> 0) return;
			e = e + (b * 12 | 0) | 0;
			if ((h | 0) == (e | 0)) return;
			c[g >> 2] = h + (~(((h + -12 - e | 0) >>> 0) / 12 | 0) * 12 | 0);
			return;
		}
		function ne(a, b, d, e) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			var f = 0, g = 0;
			f = c[a >> 2] | 0;
			g = c[a + 4 >> 2] | 0;
			a = b + (g >> 1) | 0;
			if (!(g & 1)) {
				b = f;
				Cc[b & 31](a, d, e);
				return;
			} else {
				b = c[(c[a >> 2] | 0) + f >> 2] | 0;
				Cc[b & 31](a, d, e);
				return;
			}
		}
		function oe(a) {
			a = a | 0;
			return ((c[a + 4 >> 2] | 0) - (c[a >> 2] | 0) | 0) / 12 | 0 | 0;
		}
		function pe(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0;
			d = c[a >> 2] | 0;
			e = c[a + 4 >> 2] | 0;
			a = b + (e >> 1) | 0;
			if (!(e & 1)) {
				b = d;
				a = Ac[b & 31](a) | 0;
				return a | 0;
			} else {
				b = c[(c[a >> 2] | 0) + d >> 2] | 0;
				a = Ac[b & 31](a) | 0;
				return a | 0;
			}
		}
		function qe(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0;
			g = i;
			i = i + 16 | 0;
			f = g;
			e = c[b >> 2] | 0;
			if ((((c[b + 4 >> 2] | 0) - e | 0) / 12 | 0) >>> 0 > d >>> 0) {
				d = e + (d * 12 | 0) | 0;
				e = bg(12) | 0;
				c[e + 0 >> 2] = c[d + 0 >> 2];
				c[e + 4 >> 2] = c[d + 4 >> 2];
				c[e + 8 >> 2] = c[d + 8 >> 2];
				c[f >> 2] = e;
				c[a >> 2] = xb(1320, f | 0) | 0;
				i = g;
				return;
			} else {
				c[a >> 2] = 1;
				i = g;
				return;
			}
		}
		function re(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0;
			e = i;
			i = i + 16 | 0;
			f = e;
			Cc[c[a >> 2] & 31](f, b, d);
			cc(c[f >> 2] | 0);
			d = c[f >> 2] | 0;
			bb(d | 0);
			i = e;
			return d | 0;
		}
		function se(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			b = (c[a >> 2] | 0) + (b * 12 | 0) | 0;
			c[b + 0 >> 2] = c[d + 0 >> 2];
			c[b + 4 >> 2] = c[d + 4 >> 2];
			c[b + 8 >> 2] = c[d + 8 >> 2];
			return 1;
		}
		function te(a, b, d, e) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			return Bc[c[a >> 2] & 15](b, d, e) | 0;
		}
		function ue(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0, f = 0, g = 0, h = 0, i = 0, j = 0;
			c[a >> 2] = 0;
			i = a + 4 | 0;
			c[i >> 2] = 0;
			e = a + 8 | 0;
			c[e >> 2] = 0;
			h = b + 4 | 0;
			j = c[h >> 2] | 0;
			d = c[b >> 2] | 0;
			f = j - d | 0;
			g = (f | 0) / 24 | 0;
			if ((j | 0) == (d | 0)) return;
			if (g >>> 0 > 178956970) $f(a);
			d = bg(f) | 0;
			c[i >> 2] = d;
			c[a >> 2] = d;
			c[e >> 2] = d + (g * 24 | 0);
			e = c[b >> 2] | 0;
			f = c[h >> 2] | 0;
			if ((e | 0) == (f | 0)) return;
			do {
				c[d + 0 >> 2] = c[e + 0 >> 2];
				c[d + 4 >> 2] = c[e + 4 >> 2];
				c[d + 8 >> 2] = c[e + 8 >> 2];
				c[d + 12 >> 2] = c[e + 12 >> 2];
				c[d + 16 >> 2] = c[e + 16 >> 2];
				c[d + 20 >> 2] = c[e + 20 >> 2];
				d = (c[i >> 2] | 0) + 24 | 0;
				c[i >> 2] = d;
				e = e + 24 | 0;
			} while ((e | 0) != (f | 0));
			return;
		}
		function ve(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0, l = 0;
			g = b;
			l = (d - g | 0) / 24 | 0;
			k = a + 8 | 0;
			e = c[k >> 2] | 0;
			j = c[a >> 2] | 0;
			h = j;
			if (l >>> 0 <= ((e - h | 0) / 24 | 0) >>> 0) {
				i = a + 4 | 0;
				f = (c[i >> 2] | 0) - h | 0;
				e = (f | 0) / 24 | 0;
				if (l >>> 0 <= e >>> 0) {
					e = d - g | 0;
					ch(j | 0, b | 0, e | 0) | 0;
					b = j + (((e | 0) / 24 | 0) * 24 | 0) | 0;
					e = c[i >> 2] | 0;
					if ((e | 0) == (b | 0)) return;
					c[i >> 2] = e + (~(((e + -24 - b | 0) >>> 0) / 24 | 0) * 24 | 0);
					return;
				}
				e = b + (e * 24 | 0) | 0;
				ch(j | 0, b | 0, f | 0) | 0;
				if ((e | 0) == (d | 0)) return;
				b = e;
				e = c[i >> 2] | 0;
				do {
					if (!e) e = 0; else {
						c[e + 0 >> 2] = c[b + 0 >> 2];
						c[e + 4 >> 2] = c[b + 4 >> 2];
						c[e + 8 >> 2] = c[b + 8 >> 2];
						c[e + 12 >> 2] = c[b + 12 >> 2];
						c[e + 16 >> 2] = c[b + 16 >> 2];
						c[e + 20 >> 2] = c[b + 20 >> 2];
						e = c[i >> 2] | 0;
					}
					e = e + 24 | 0;
					c[i >> 2] = e;
					b = b + 24 | 0;
				} while ((b | 0) != (d | 0));
				return;
			}
			if (j) {
				f = a + 4 | 0;
				e = c[f >> 2] | 0;
				if ((e | 0) != (j | 0)) c[f >> 2] = e + (~(((e + -24 - h | 0) >>> 0) / 24 | 0) * 24 | 0);
				cg(j);
				c[k >> 2] = 0;
				c[f >> 2] = 0;
				c[a >> 2] = 0;
				e = 0;
			}
			g = l >>> 0 > 178956970;
			if (g) $f(a);
			e = (e - 0 | 0) / 24 | 0;
			if (e >>> 0 < 89478485) {
				f = e << 1;
				e = f >>> 0 >= l >>> 0;
				if (e | g ^ 1) i = e ? f : l; else $f(a);
			} else i = 178956970;
			e = bg(i * 24 | 0) | 0;
			f = a + 4 | 0;
			c[f >> 2] = e;
			c[a >> 2] = e;
			c[k >> 2] = e + (i * 24 | 0);
			if ((b | 0) == (d | 0)) return;
			do {
				c[e + 0 >> 2] = c[b + 0 >> 2];
				c[e + 4 >> 2] = c[b + 4 >> 2];
				c[e + 8 >> 2] = c[b + 8 >> 2];
				c[e + 12 >> 2] = c[b + 12 >> 2];
				c[e + 16 >> 2] = c[b + 16 >> 2];
				c[e + 20 >> 2] = c[b + 20 >> 2];
				e = (c[f >> 2] | 0) + 24 | 0;
				c[f >> 2] = e;
				b = b + 24 | 0;
			} while ((b | 0) != (d | 0));
			return;
		}
		function we(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0, f = 0, g = 0, h = 0, i = 0;
			c[a >> 2] = 0;
			i = a + 4 | 0;
			c[i >> 2] = 0;
			e = a + 8 | 0;
			c[e >> 2] = 0;
			h = b + 4 | 0;
			f = (c[h >> 2] | 0) - (c[b >> 2] | 0) | 0;
			g = f >> 4;
			if (!g) return;
			if (g >>> 0 > 268435455) $f(a);
			d = bg(f) | 0;
			c[i >> 2] = d;
			c[a >> 2] = d;
			c[e >> 2] = d + (g << 4);
			e = c[b >> 2] | 0;
			f = c[h >> 2] | 0;
			if ((e | 0) == (f | 0)) return;
			do {
				c[d + 0 >> 2] = c[e + 0 >> 2];
				c[d + 4 >> 2] = c[e + 4 >> 2];
				c[d + 8 >> 2] = c[e + 8 >> 2];
				c[d + 12 >> 2] = c[e + 12 >> 2];
				d = (c[i >> 2] | 0) + 16 | 0;
				c[i >> 2] = d;
				e = e + 16 | 0;
			} while ((e | 0) != (f | 0));
			return;
		}
		function xe(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0, l = 0;
			g = b;
			k = d - g >> 4;
			l = a + 8 | 0;
			e = c[l >> 2] | 0;
			j = c[a >> 2] | 0;
			h = j;
			if (k >>> 0 <= e - h >> 4 >>> 0) {
				i = a + 4 | 0;
				f = (c[i >> 2] | 0) - h | 0;
				e = f >> 4;
				if (k >>> 0 <= e >>> 0) {
					e = d - g | 0;
					ch(j | 0, b | 0, e | 0) | 0;
					b = j + (e >> 4 << 4) | 0;
					e = c[i >> 2] | 0;
					if ((e | 0) == (b | 0)) return;
					c[i >> 2] = e + (~((e + -16 - b | 0) >>> 4) << 4);
					return;
				}
				e = b + (e << 4) | 0;
				ch(j | 0, b | 0, f | 0) | 0;
				if ((e | 0) == (d | 0)) return;
				b = e;
				e = c[i >> 2] | 0;
				do {
					if (!e) e = 0; else {
						c[e + 0 >> 2] = c[b + 0 >> 2];
						c[e + 4 >> 2] = c[b + 4 >> 2];
						c[e + 8 >> 2] = c[b + 8 >> 2];
						c[e + 12 >> 2] = c[b + 12 >> 2];
						e = c[i >> 2] | 0;
					}
					e = e + 16 | 0;
					c[i >> 2] = e;
					b = b + 16 | 0;
				} while ((b | 0) != (d | 0));
				return;
			}
			if (j) {
				f = a + 4 | 0;
				e = c[f >> 2] | 0;
				if ((e | 0) != (j | 0)) c[f >> 2] = e + (~((e + -16 - h | 0) >>> 4) << 4);
				cg(j);
				c[l >> 2] = 0;
				c[f >> 2] = 0;
				c[a >> 2] = 0;
				e = 0;
			}
			if (k >>> 0 > 268435455) $f(a);
			e = e - 0 | 0;
			if (e >> 4 >>> 0 < 134217727) {
				e = e >> 3;
				e = e >>> 0 < k >>> 0 ? k : e;
				if (e >>> 0 > 268435455) $f(a); else i = e;
			} else i = 268435455;
			e = bg(i << 4) | 0;
			f = a + 4 | 0;
			c[f >> 2] = e;
			c[a >> 2] = e;
			c[l >> 2] = e + (i << 4);
			if ((b | 0) == (d | 0)) return;
			do {
				c[e + 0 >> 2] = c[b + 0 >> 2];
				c[e + 4 >> 2] = c[b + 4 >> 2];
				c[e + 8 >> 2] = c[b + 8 >> 2];
				c[e + 12 >> 2] = c[b + 12 >> 2];
				e = (c[f >> 2] | 0) + 16 | 0;
				c[f >> 2] = e;
				b = b + 16 | 0;
			} while ((b | 0) != (d | 0));
			return;
		}
		function ye(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0, f = 0, g = 0, h = 0, i = 0, j = 0;
			c[a >> 2] = 0;
			i = a + 4 | 0;
			c[i >> 2] = 0;
			e = a + 8 | 0;
			c[e >> 2] = 0;
			h = b + 4 | 0;
			j = c[h >> 2] | 0;
			d = c[b >> 2] | 0;
			f = j - d | 0;
			g = (f | 0) / 12 | 0;
			if ((j | 0) == (d | 0)) return;
			if (g >>> 0 > 357913941) $f(a);
			d = bg(f) | 0;
			c[i >> 2] = d;
			c[a >> 2] = d;
			c[e >> 2] = d + (g * 12 | 0);
			e = c[b >> 2] | 0;
			f = c[h >> 2] | 0;
			if ((e | 0) == (f | 0)) return;
			do {
				c[d + 0 >> 2] = c[e + 0 >> 2];
				c[d + 4 >> 2] = c[e + 4 >> 2];
				c[d + 8 >> 2] = c[e + 8 >> 2];
				d = (c[i >> 2] | 0) + 12 | 0;
				c[i >> 2] = d;
				e = e + 12 | 0;
			} while ((e | 0) != (f | 0));
			return;
		}
		function ze(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0, l = 0;
			g = b;
			l = (d - g | 0) / 12 | 0;
			k = a + 8 | 0;
			e = c[k >> 2] | 0;
			j = c[a >> 2] | 0;
			h = j;
			if (l >>> 0 <= ((e - h | 0) / 12 | 0) >>> 0) {
				i = a + 4 | 0;
				f = (c[i >> 2] | 0) - h | 0;
				e = (f | 0) / 12 | 0;
				if (l >>> 0 <= e >>> 0) {
					e = d - g | 0;
					ch(j | 0, b | 0, e | 0) | 0;
					b = j + (((e | 0) / 12 | 0) * 12 | 0) | 0;
					e = c[i >> 2] | 0;
					if ((e | 0) == (b | 0)) return;
					c[i >> 2] = e + (~(((e + -12 - b | 0) >>> 0) / 12 | 0) * 12 | 0);
					return;
				}
				e = b + (e * 12 | 0) | 0;
				ch(j | 0, b | 0, f | 0) | 0;
				if ((e | 0) == (d | 0)) return;
				b = e;
				e = c[i >> 2] | 0;
				do {
					if (!e) e = 0; else {
						c[e + 0 >> 2] = c[b + 0 >> 2];
						c[e + 4 >> 2] = c[b + 4 >> 2];
						c[e + 8 >> 2] = c[b + 8 >> 2];
						e = c[i >> 2] | 0;
					}
					e = e + 12 | 0;
					c[i >> 2] = e;
					b = b + 12 | 0;
				} while ((b | 0) != (d | 0));
				return;
			}
			if (j) {
				f = a + 4 | 0;
				e = c[f >> 2] | 0;
				if ((e | 0) != (j | 0)) c[f >> 2] = e + (~(((e + -12 - h | 0) >>> 0) / 12 | 0) * 12 | 0);
				cg(j);
				c[k >> 2] = 0;
				c[f >> 2] = 0;
				c[a >> 2] = 0;
				e = 0;
			}
			g = l >>> 0 > 357913941;
			if (g) $f(a);
			e = (e - 0 | 0) / 12 | 0;
			if (e >>> 0 < 178956970) {
				f = e << 1;
				e = f >>> 0 >= l >>> 0;
				if (e | g ^ 1) i = e ? f : l; else $f(a);
			} else i = 357913941;
			e = bg(i * 12 | 0) | 0;
			f = a + 4 | 0;
			c[f >> 2] = e;
			c[a >> 2] = e;
			c[k >> 2] = e + (i * 12 | 0);
			if ((b | 0) == (d | 0)) return;
			do {
				c[e + 0 >> 2] = c[b + 0 >> 2];
				c[e + 4 >> 2] = c[b + 4 >> 2];
				c[e + 8 >> 2] = c[b + 8 >> 2];
				e = (c[f >> 2] | 0) + 12 | 0;
				c[f >> 2] = e;
				b = b + 12 | 0;
			} while ((b | 0) != (d | 0));
			return;
		}
		function Ae(a) {
			a = a | 0;
			var b = 0, d = 0, e = 0, f = 0;
			b = c[a + 2768 >> 2] | 0;
			if (b) do {
				d = b;
				b = c[b >> 2] | 0;
				cg(d);
			} while ((b | 0) != 0);
			d = a + 2760 | 0;
			b = c[d >> 2] | 0;
			c[d >> 2] = 0;
			if (b) cg(b);
			b = c[a + 2748 >> 2] | 0;
			if (b) do {
				d = b;
				b = c[b >> 2] | 0;
				cg(d);
			} while ((b | 0) != 0);
			d = a + 2740 | 0;
			b = c[d >> 2] | 0;
			c[d >> 2] = 0;
			if (b) cg(b);
			e = c[a + 2724 >> 2] | 0;
			d = e;
			if (e) {
				b = a + 2728 | 0;
				f = c[b >> 2] | 0;
				if ((f | 0) != (e | 0)) c[b >> 2] = f + (~(((f + -24 - d | 0) >>> 0) / 24 | 0) * 24 | 0);
				cg(e);
			}
			f = c[a + 2712 >> 2] | 0;
			e = f;
			if (f) {
				d = a + 2716 | 0;
				b = c[d >> 2] | 0;
				if ((b | 0) != (f | 0)) c[d >> 2] = b + (~(((b + -24 - e | 0) >>> 0) / 24 | 0) * 24 | 0);
				cg(f);
			}
			b = c[a + 2700 >> 2] | 0;
			if (!b) {
				Ne(a);
				return;
			}
			d = a + 2704 | 0;
			e = c[d >> 2] | 0;
			if ((e | 0) != (b | 0)) c[d >> 2] = e + (~(((e + -12 - b | 0) >>> 0) / 12 | 0) * 12 | 0);
			cg(b);
			Ne(a);
			return;
		}
		function Be(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0, l = 0, m = 0;
			k = a + 4 | 0;
			l = c[a >> 2] | 0;
			e = (((c[k >> 2] | 0) - l | 0) / 28 | 0) + 1 | 0;
			if (e >>> 0 > 153391689) $f(a);
			m = a + 8 | 0;
			f = l;
			d = ((c[m >> 2] | 0) - f | 0) / 28 | 0;
			if (d >>> 0 < 76695844) {
				d = d << 1;
				e = d >>> 0 < e >>> 0 ? e : d;
				d = (c[k >> 2] | 0) - f | 0;
				f = (d | 0) / 28 | 0;
				if (!e) {
					i = 0;
					h = 0;
					g = f;
					e = d;
				} else j = 6;
			} else {
				d = (c[k >> 2] | 0) - f | 0;
				e = 153391689;
				f = (d | 0) / 28 | 0;
				j = 6;
			}
			if ((j | 0) == 6) {
				i = e;
				h = bg(e * 28 | 0) | 0;
				g = f;
				e = d;
			}
			f = h + (g * 28 | 0) | 0;
			if (f) {
				c[f + 0 >> 2] = c[b + 0 >> 2];
				c[f + 4 >> 2] = c[b + 4 >> 2];
				c[f + 8 >> 2] = c[b + 8 >> 2];
				c[f + 12 >> 2] = c[b + 12 >> 2];
				c[f + 16 >> 2] = c[b + 16 >> 2];
				c[f + 20 >> 2] = c[b + 20 >> 2];
				c[f + 24 >> 2] = c[b + 24 >> 2];
			}
			j = h + ((((e | 0) / -28 | 0) + g | 0) * 28 | 0) | 0;
			bh(j | 0, l | 0, e | 0) | 0;
			c[a >> 2] = j;
			c[k >> 2] = h + ((g + 1 | 0) * 28 | 0);
			c[m >> 2] = h + (i * 28 | 0);
			if (!l) return;
			cg(l);
			return;
		}
		function Ce(a, b, d, e, f) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			var g = 0, h = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0;
			r = i;
			i = i + 128 | 0;
			g = r + 96 | 0;
			h = r + 64 | 0;
			p = r + 32 | 0;
			q = r;
			n = c[b >> 2] | 0;
			l = c[d >> 2] | 0;
			m = a + 4 | 0;
			o = g;
			c[o >> 2] = n;
			c[o + 4 >> 2] = l;
			o = g + 8 | 0;
			c[o >> 2] = n;
			c[o + 4 >> 2] = l;
			c[g + 16 >> 2] = 0;
			c[g + 24 >> 2] = 0;
			o = a + 8 | 0;
			d = c[o >> 2] | 0;
			j = a + 12 | 0;
			if (d >>> 0 < (c[j >> 2] | 0) >>> 0) {
				if (!d) d = 0; else {
					c[d + 0 >> 2] = c[g + 0 >> 2];
					c[d + 4 >> 2] = c[g + 4 >> 2];
					c[d + 8 >> 2] = c[g + 8 >> 2];
					c[d + 12 >> 2] = c[g + 12 >> 2];
					c[d + 16 >> 2] = c[g + 16 >> 2];
					c[d + 20 >> 2] = c[g + 20 >> 2];
					c[d + 24 >> 2] = c[g + 24 >> 2];
					d = c[o >> 2] | 0;
				}
				g = d + 28 | 0;
				c[o >> 2] = g;
			} else {
				Be(m, g);
				g = c[o >> 2] | 0;
			}
			k = a + 2696 | 0;
			c[g + -8 >> 2] = c[k >> 2];
			a = g + -4 | 0;
			c[a >> 2] = c[a >> 2] | 1;
			a = c[e >> 2] | 0;
			e = c[f >> 2] | 0;
			f = h;
			c[f >> 2] = a;
			c[f + 4 >> 2] = e;
			f = h + 8 | 0;
			c[f >> 2] = a;
			c[f + 4 >> 2] = e;
			c[h + 16 >> 2] = 0;
			c[h + 24 >> 2] = 0;
			if (g >>> 0 < (c[j >> 2] | 0) >>> 0) {
				if (!g) d = 0; else {
					c[g + 0 >> 2] = c[h + 0 >> 2];
					c[g + 4 >> 2] = c[h + 4 >> 2];
					c[g + 8 >> 2] = c[h + 8 >> 2];
					c[g + 12 >> 2] = c[h + 12 >> 2];
					c[g + 16 >> 2] = c[h + 16 >> 2];
					c[g + 20 >> 2] = c[h + 20 >> 2];
					c[g + 24 >> 2] = c[h + 24 >> 2];
					d = c[o >> 2] | 0;
				}
				d = d + 28 | 0;
				c[o >> 2] = d;
			} else {
				Be(m, h);
				d = c[o >> 2] | 0;
			}
			c[d + -8 >> 2] = c[k >> 2];
			h = d + -4 | 0;
			c[h >> 2] = c[h >> 2] | 2;
			if ((n | 0) == (a | 0)) if ((l | 0) < (e | 0)) b = 14; else b = 20; else if ((n | 0) < (a | 0)) b = 14; else b = 20;
			if ((b | 0) == 14) {
				h = p;
				c[h >> 2] = n;
				c[h + 4 >> 2] = l;
				l = p + 8 | 0;
				c[l >> 2] = a;
				c[l + 4 >> 2] = e;
				c[p + 16 >> 2] = 0;
				c[p + 24 >> 2] = 0;
				if (d >>> 0 < (c[j >> 2] | 0) >>> 0) {
					if (!d) b = 0; else {
						c[d + 0 >> 2] = c[p + 0 >> 2];
						c[d + 4 >> 2] = c[p + 4 >> 2];
						c[d + 8 >> 2] = c[p + 8 >> 2];
						c[d + 12 >> 2] = c[p + 12 >> 2];
						c[d + 16 >> 2] = c[p + 16 >> 2];
						c[d + 20 >> 2] = c[p + 20 >> 2];
						c[d + 24 >> 2] = c[p + 24 >> 2];
						b = c[o >> 2] | 0;
					}
					b = b + 28 | 0;
					c[o >> 2] = b;
				} else {
					Be(m, p);
					b = c[o >> 2] | 0;
				}
				j = b + -4 | 0;
				c[j >> 2] = c[j >> 2] | 8;
				j = b;
				l = c[k >> 2] | 0;
				j = j + -8 | 0;
				c[j >> 2] = l;
				j = l + 1 | 0;
				c[k >> 2] = j;
				i = r;
				return l | 0;
			} else if ((b | 0) == 20) {
				h = q;
				c[h >> 2] = a;
				c[h + 4 >> 2] = e;
				h = q + 8 | 0;
				c[h >> 2] = n;
				c[h + 4 >> 2] = l;
				c[q + 16 >> 2] = 0;
				c[q + 24 >> 2] = 0;
				if (d >>> 0 < (c[j >> 2] | 0) >>> 0) {
					if (!d) b = 0; else {
						c[d + 0 >> 2] = c[q + 0 >> 2];
						c[d + 4 >> 2] = c[q + 4 >> 2];
						c[d + 8 >> 2] = c[q + 8 >> 2];
						c[d + 12 >> 2] = c[q + 12 >> 2];
						c[d + 16 >> 2] = c[q + 16 >> 2];
						c[d + 20 >> 2] = c[q + 20 >> 2];
						c[d + 24 >> 2] = c[q + 24 >> 2];
						b = c[o >> 2] | 0;
					}
					b = b + 28 | 0;
					c[o >> 2] = b;
				} else {
					Be(m, q);
					b = c[o >> 2] | 0;
				}
				j = b + -4 | 0;
				c[j >> 2] = c[j >> 2] | 9;
				j = b;
				l = c[k >> 2] | 0;
				j = j + -8 | 0;
				c[j >> 2] = l;
				j = l + 1 | 0;
				c[k >> 2] = j;
				i = r;
				return l | 0;
			}
			return 0;
		}
		function De(e, f) {
			e = e | 0;
			f = f | 0;
			var g = 0, j = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0, v = 0, w = 0, x = 0, y = 0, z = 0, A = 0, B = 0, C = 0;
			A = i;
			i = i + 32 | 0;
			p = A + 24 | 0;
			o = A + 20 | 0;
			n = A + 16 | 0;
			q = A + 12 | 0;
			r = A + 8 | 0;
			x = A + 4 | 0;
			z = A;
			y = e + 8 | 0;
			Oe(f, ((c[y >> 2] | 0) - (c[e + 4 >> 2] | 0) | 0) / 28 | 0);
			Pe(e);
			Qe(e, f);
			s = e + 36 | 0;
			t = e + 40 | 0;
			u = e + 16 | 0;
			v = e + 48 | 0;
			w = e + 60 | 0;
			m = c[s >> 2] | 0;
			g = c[t >> 2] | 0;
			a: while (1) {
				j = c[u >> 2] | 0;
				l = (j | 0) == (c[y >> 2] | 0);
				do if ((m | 0) != (g | 0)) {
					if (l) {
						Se(e, f);
						break;
					}
					B = (c[m >> 2] | 0) + 24 | 0;
					l = c[B >> 2] | 0;
					B = c[B + 4 >> 2] | 0;
					h[k >> 3] = +(c[j >> 2] | 0);
					g = c[k >> 2] | 0;
					C = c[k + 4 >> 2] | 0;
					m = (C | 0) > -1 | (C | 0) == -1 & g >>> 0 > 4294967295;
					j = Xg(0, -2147483648, g | 0, C | 0) | 0;
					g = m ? j : g;
					C = m ? D : C;
					m = (B | 0) > -1 | (B | 0) == -1 & l >>> 0 > 4294967295;
					j = Xg(0, -2147483648, l | 0, B | 0) | 0;
					j = m ? j : l;
					B = m ? D : B;
					m = Xg(g | 0, C | 0, j | 0, B | 0) | 0;
					l = D;
					if ((C >>> 0 > B >>> 0 | (C | 0) == (B | 0) & g >>> 0 > j >>> 0) & (l >>> 0 > 0 | (l | 0) == 0 & m >>> 0 > 64)) {
						Re(e, f);
						break;
					} else {
						Se(e, f);
						break;
					}
				} else {
					if (l) break a;
					Re(e, f);
				} while (0);
				j = c[s >> 2] | 0;
				g = c[t >> 2] | 0;
				if ((j | 0) == (g | 0)) {
					m = j;
					g = j;
					continue;
				}
				while (1) {
					m = c[j >> 2] | 0;
					if (a[m + 32 >> 0] | 0) {
						m = j;
						continue a;
					}
					b[z >> 1] = d[v >> 0] | d[v + 1 >> 0] << 8;
					l = g - j | 0;
					if ((l | 0) > 4) {
						g = g + -4 | 0;
						c[j >> 2] = c[g >> 2];
						c[g >> 2] = m;
						c[q >> 2] = j;
						c[r >> 2] = g;
						c[x >> 2] = j;
						c[n + 0 >> 2] = c[q + 0 >> 2];
						c[o + 0 >> 2] = c[r + 0 >> 2];
						c[p + 0 >> 2] = c[x + 0 >> 2];
						Te(n, o, z, (l >> 2) + -1 | 0, p);
						g = c[t >> 2] | 0;
					}
					c[t >> 2] = g + -4;
					j = m + 4 | 0;
					g = c[m >> 2] | 0;
					c[g + 4 >> 2] = c[j >> 2];
					c[c[j >> 2] >> 2] = g;
					c[w >> 2] = (c[w >> 2] | 0) + -1;
					cg(m);
					j = c[s >> 2] | 0;
					g = c[t >> 2] | 0;
					if ((j | 0) == (g | 0)) {
						m = j;
						g = j;
						continue a;
					}
				}
			}
			r = e + 64 | 0;
			s = e + 68 | 0;
			Ue(r, c[s >> 2] | 0);
			c[e + 72 >> 2] = 0;
			c[r >> 2] = s;
			c[s >> 2] = 0;
			Ve(f);
			i = A;
			return;
		}
		function Ee(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0, f = 0, g = 0, h = 0, j = 0, k = 0, l = 0;
			l = i;
			i = i + 16 | 0;
			k = l;
			f = c[b >> 2] | 0;
			b = $(f, 1540483477) | 0;
			b = ($(b >>> 24 ^ b, 1540483477) | 0) ^ 1866966612;
			b = $(b >>> 13 ^ b, 1540483477) | 0;
			b = b >>> 15 ^ b;
			g = c[a + 4 >> 2] | 0;
			a: do if (g) {
				h = g + -1 | 0;
				j = (h & g | 0) == 0;
				if (j) e = b & h; else e = (b >>> 0) % (g >>> 0) | 0;
				b = c[(c[a >> 2] | 0) + (e << 2) >> 2] | 0;
				if (b) {
					do {
						b = c[b >> 2] | 0;
						if (!b) break a;
						d = c[b + 4 >> 2] | 0;
						if (j) d = d & h; else d = (d >>> 0) % (g >>> 0) | 0;
						if ((d | 0) != (e | 0)) break a;
					} while ((c[b + 8 >> 2] | 0) != (f | 0));
					b = b + 12 | 0;
					i = l;
					return b | 0;
				}
			} while (0);
			b = bg(16) | 0;
			c[b + 8 >> 2] = f;
			c[b + 12 >> 2] = 0;
			We(k, a, b);
			b = c[k >> 2] | 0;
			b = b + 12 | 0;
			i = l;
			return b | 0;
		}
		function Fe(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0, l = 0, m = 0;
			k = a + 4 | 0;
			l = c[a >> 2] | 0;
			e = (((c[k >> 2] | 0) - l | 0) / 24 | 0) + 1 | 0;
			if (e >>> 0 > 178956970) $f(a);
			m = a + 8 | 0;
			f = l;
			d = ((c[m >> 2] | 0) - f | 0) / 24 | 0;
			if (d >>> 0 < 89478485) {
				d = d << 1;
				e = d >>> 0 < e >>> 0 ? e : d;
				d = (c[k >> 2] | 0) - f | 0;
				f = (d | 0) / 24 | 0;
				if (!e) {
					i = 0;
					h = 0;
					g = f;
					e = d;
				} else j = 6;
			} else {
				d = (c[k >> 2] | 0) - f | 0;
				e = 178956970;
				f = (d | 0) / 24 | 0;
				j = 6;
			}
			if ((j | 0) == 6) {
				i = e;
				h = bg(e * 24 | 0) | 0;
				g = f;
				e = d;
			}
			f = h + (g * 24 | 0) | 0;
			if (f) {
				c[f + 0 >> 2] = c[b + 0 >> 2];
				c[f + 4 >> 2] = c[b + 4 >> 2];
				c[f + 8 >> 2] = c[b + 8 >> 2];
				c[f + 12 >> 2] = c[b + 12 >> 2];
				c[f + 16 >> 2] = c[b + 16 >> 2];
				c[f + 20 >> 2] = c[b + 20 >> 2];
			}
			j = h + ((((e | 0) / -24 | 0) + g | 0) * 24 | 0) | 0;
			bh(j | 0, l | 0, e | 0) | 0;
			c[a >> 2] = j;
			c[k >> 2] = h + ((g + 1 | 0) * 24 | 0);
			c[m >> 2] = h + (i * 24 | 0);
			if (!l) return;
			cg(l);
			return;
		}
		function Ge(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0, f = 0, g = 0, h = 0, j = 0, k = 0, l = 0;
			l = i;
			i = i + 16 | 0;
			k = l;
			f = c[b >> 2] | 0;
			b = $(f, 1540483477) | 0;
			b = ($(b >>> 24 ^ b, 1540483477) | 0) ^ 1866966612;
			b = $(b >>> 13 ^ b, 1540483477) | 0;
			b = b >>> 15 ^ b;
			g = c[a + 4 >> 2] | 0;
			a: do if (g) {
				h = g + -1 | 0;
				j = (h & g | 0) == 0;
				if (j) e = b & h; else e = (b >>> 0) % (g >>> 0) | 0;
				b = c[(c[a >> 2] | 0) + (e << 2) >> 2] | 0;
				if (b) {
					do {
						b = c[b >> 2] | 0;
						if (!b) break a;
						d = c[b + 4 >> 2] | 0;
						if (j) d = d & h; else d = (d >>> 0) % (g >>> 0) | 0;
						if ((d | 0) != (e | 0)) break a;
					} while ((c[b + 8 >> 2] | 0) != (f | 0));
					b = b + 12 | 0;
					i = l;
					return b | 0;
				}
			} while (0);
			b = bg(16) | 0;
			c[b + 8 >> 2] = f;
			c[b + 12 >> 2] = 0;
			Xe(k, a, b);
			b = c[k >> 2] | 0;
			b = b + 12 | 0;
			i = l;
			return b | 0;
		}
		function He(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0, l = 0, m = 0;
			k = a + 4 | 0;
			l = c[a >> 2] | 0;
			e = (((c[k >> 2] | 0) - l | 0) / 12 | 0) + 1 | 0;
			if (e >>> 0 > 357913941) $f(a);
			m = a + 8 | 0;
			f = l;
			d = ((c[m >> 2] | 0) - f | 0) / 12 | 0;
			if (d >>> 0 < 178956970) {
				d = d << 1;
				e = d >>> 0 < e >>> 0 ? e : d;
				d = (c[k >> 2] | 0) - f | 0;
				f = (d | 0) / 12 | 0;
				if (!e) {
					i = 0;
					h = 0;
					g = f;
					e = d;
				} else j = 6;
			} else {
				d = (c[k >> 2] | 0) - f | 0;
				e = 357913941;
				f = (d | 0) / 12 | 0;
				j = 6;
			}
			if ((j | 0) == 6) {
				i = e;
				h = bg(e * 12 | 0) | 0;
				g = f;
				e = d;
			}
			f = h + (g * 12 | 0) | 0;
			if (f) {
				c[f + 0 >> 2] = c[b + 0 >> 2];
				c[f + 4 >> 2] = c[b + 4 >> 2];
				c[f + 8 >> 2] = c[b + 8 >> 2];
			}
			j = h + ((((e | 0) / -12 | 0) + g | 0) * 12 | 0) | 0;
			bh(j | 0, l | 0, e | 0) | 0;
			c[a >> 2] = j;
			c[k >> 2] = h + ((g + 1 | 0) * 12 | 0);
			c[m >> 2] = h + (i * 12 | 0);
			if (!l) return;
			cg(l);
			return;
		}
		function Ie(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0, l = 0, m = 0;
			k = a + 4 | 0;
			l = c[a >> 2] | 0;
			e = ((c[k >> 2] | 0) - l >> 4) + 1 | 0;
			if (e >>> 0 > 268435455) $f(a);
			m = a + 8 | 0;
			f = l;
			d = (c[m >> 2] | 0) - f | 0;
			if (d >> 4 >>> 0 < 134217727) {
				d = d >> 3;
				e = d >>> 0 < e >>> 0 ? e : d;
				d = (c[k >> 2] | 0) - f | 0;
				f = d >> 4;
				if (!e) {
					i = 0;
					h = 0;
					g = f;
					e = d;
				} else j = 6;
			} else {
				d = (c[k >> 2] | 0) - f | 0;
				e = 268435455;
				f = d >> 4;
				j = 6;
			}
			if ((j | 0) == 6) {
				i = e;
				h = bg(e << 4) | 0;
				g = f;
				e = d;
			}
			f = h + (g << 4) | 0;
			if (f) {
				c[f + 0 >> 2] = c[b + 0 >> 2];
				c[f + 4 >> 2] = c[b + 4 >> 2];
				c[f + 8 >> 2] = c[b + 8 >> 2];
				c[f + 12 >> 2] = c[b + 12 >> 2];
			}
			bh(h | 0, l | 0, e | 0) | 0;
			c[a >> 2] = h;
			c[k >> 2] = h + (g + 1 << 4);
			c[m >> 2] = h + (i << 4);
			if (!l) return;
			cg(l);
			return;
		}
		function Je(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0;
			j = a + 8 | 0;
			g = c[j >> 2] | 0;
			k = a + 4 | 0;
			e = c[k >> 2] | 0;
			f = e;
			if (((g - f | 0) / 24 | 0) >>> 0 >= b >>> 0) {
				do {
					if (!e) e = 0; else {
						c[e + 0 >> 2] = c[d + 0 >> 2];
						c[e + 4 >> 2] = c[d + 4 >> 2];
						c[e + 8 >> 2] = c[d + 8 >> 2];
						c[e + 12 >> 2] = c[d + 12 >> 2];
						c[e + 16 >> 2] = c[d + 16 >> 2];
						c[e + 20 >> 2] = c[d + 20 >> 2];
						e = c[k >> 2] | 0;
					}
					e = e + 24 | 0;
					c[k >> 2] = e;
					b = b + -1 | 0;
				} while ((b | 0) != 0);
				return;
			}
			e = c[a >> 2] | 0;
			f = ((f - e | 0) / 24 | 0) + b | 0;
			if (f >>> 0 > 178956970) $f(a);
			h = e;
			e = (g - h | 0) / 24 | 0;
			if (e >>> 0 < 89478485) {
				e = e << 1;
				e = e >>> 0 < f >>> 0 ? f : e;
				f = ((c[k >> 2] | 0) - h | 0) / 24 | 0;
				if (!e) {
					g = 0;
					h = 0;
				} else i = 11;
			} else {
				e = 178956970;
				f = ((c[k >> 2] | 0) - h | 0) / 24 | 0;
				i = 11;
			}
			if ((i | 0) == 11) {
				g = e;
				h = bg(e * 24 | 0) | 0;
			}
			e = h + (f * 24 | 0) | 0;
			do {
				if (!e) e = 0; else {
					c[e + 0 >> 2] = c[d + 0 >> 2];
					c[e + 4 >> 2] = c[d + 4 >> 2];
					c[e + 8 >> 2] = c[d + 8 >> 2];
					c[e + 12 >> 2] = c[d + 12 >> 2];
					c[e + 16 >> 2] = c[d + 16 >> 2];
					c[e + 20 >> 2] = c[d + 20 >> 2];
				}
				e = e + 24 | 0;
				b = b + -1 | 0;
			} while ((b | 0) != 0);
			b = e;
			e = c[a >> 2] | 0;
			i = (c[k >> 2] | 0) - e | 0;
			f = h + ((((i | 0) / -24 | 0) + f | 0) * 24 | 0) | 0;
			bh(f | 0, e | 0, i | 0) | 0;
			c[a >> 2] = f;
			c[k >> 2] = b;
			c[j >> 2] = h + (g * 24 | 0);
			if (!e) return;
			cg(e);
			return;
		}
		function Ke(a) {
			a = a | 0;
			Ea(a | 0) | 0;
			hg();
		}
		function Le(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0;
			j = a + 8 | 0;
			g = c[j >> 2] | 0;
			k = a + 4 | 0;
			e = c[k >> 2] | 0;
			f = e;
			if (g - f >> 4 >>> 0 >= b >>> 0) {
				do {
					if (!e) e = 0; else {
						c[e + 0 >> 2] = c[d + 0 >> 2];
						c[e + 4 >> 2] = c[d + 4 >> 2];
						c[e + 8 >> 2] = c[d + 8 >> 2];
						c[e + 12 >> 2] = c[d + 12 >> 2];
						e = c[k >> 2] | 0;
					}
					e = e + 16 | 0;
					c[k >> 2] = e;
					b = b + -1 | 0;
				} while ((b | 0) != 0);
				return;
			}
			e = c[a >> 2] | 0;
			f = (f - e >> 4) + b | 0;
			if (f >>> 0 > 268435455) $f(a);
			h = e;
			e = g - h | 0;
			if (e >> 4 >>> 0 < 134217727) {
				e = e >> 3;
				e = e >>> 0 < f >>> 0 ? f : e;
				f = (c[k >> 2] | 0) - h >> 4;
				if (!e) {
					g = 0;
					h = 0;
				} else i = 11;
			} else {
				e = 268435455;
				f = (c[k >> 2] | 0) - h >> 4;
				i = 11;
			}
			if ((i | 0) == 11) {
				g = e;
				h = bg(e << 4) | 0;
			}
			e = h + (f << 4) | 0;
			do {
				if (!e) e = 0; else {
					c[e + 0 >> 2] = c[d + 0 >> 2];
					c[e + 4 >> 2] = c[d + 4 >> 2];
					c[e + 8 >> 2] = c[d + 8 >> 2];
					c[e + 12 >> 2] = c[d + 12 >> 2];
				}
				e = e + 16 | 0;
				b = b + -1 | 0;
			} while ((b | 0) != 0);
			b = e;
			e = c[a >> 2] | 0;
			i = (c[k >> 2] | 0) - e | 0;
			f = h + (f - (i >> 4) << 4) | 0;
			bh(f | 0, e | 0, i | 0) | 0;
			c[a >> 2] = f;
			c[k >> 2] = b;
			c[j >> 2] = h + (g << 4);
			if (!e) return;
			cg(e);
			return;
		}
		function Me(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0;
			j = a + 8 | 0;
			g = c[j >> 2] | 0;
			k = a + 4 | 0;
			e = c[k >> 2] | 0;
			f = e;
			if (((g - f | 0) / 12 | 0) >>> 0 >= b >>> 0) {
				do {
					if (!e) e = 0; else {
						c[e + 0 >> 2] = c[d + 0 >> 2];
						c[e + 4 >> 2] = c[d + 4 >> 2];
						c[e + 8 >> 2] = c[d + 8 >> 2];
						e = c[k >> 2] | 0;
					}
					e = e + 12 | 0;
					c[k >> 2] = e;
					b = b + -1 | 0;
				} while ((b | 0) != 0);
				return;
			}
			e = c[a >> 2] | 0;
			f = ((f - e | 0) / 12 | 0) + b | 0;
			if (f >>> 0 > 357913941) $f(a);
			h = e;
			e = (g - h | 0) / 12 | 0;
			if (e >>> 0 < 178956970) {
				e = e << 1;
				e = e >>> 0 < f >>> 0 ? f : e;
				f = ((c[k >> 2] | 0) - h | 0) / 12 | 0;
				if (!e) {
					g = 0;
					h = 0;
				} else i = 11;
			} else {
				e = 357913941;
				f = ((c[k >> 2] | 0) - h | 0) / 12 | 0;
				i = 11;
			}
			if ((i | 0) == 11) {
				g = e;
				h = bg(e * 12 | 0) | 0;
			}
			e = h + (f * 12 | 0) | 0;
			do {
				if (!e) e = 0; else {
					c[e + 0 >> 2] = c[d + 0 >> 2];
					c[e + 4 >> 2] = c[d + 4 >> 2];
					c[e + 8 >> 2] = c[d + 8 >> 2];
				}
				e = e + 12 | 0;
				b = b + -1 | 0;
			} while ((b | 0) != 0);
			b = e;
			e = c[a >> 2] | 0;
			i = (c[k >> 2] | 0) - e | 0;
			f = h + ((((i | 0) / -12 | 0) + f | 0) * 12 | 0) | 0;
			bh(f | 0, e | 0, i | 0) | 0;
			c[a >> 2] = f;
			c[k >> 2] = b;
			c[j >> 2] = h + (g * 12 | 0);
			if (!e) return;
			cg(e);
			return;
		}
		function Ne(a) {
			a = a | 0;
			var b = 0, d = 0, e = 0, f = 0, g = 0;
			Ue(a + 64 | 0, c[a + 68 >> 2] | 0);
			f = a + 52 | 0;
			b = a + 60 | 0;
			if ((c[b >> 2] | 0) != 0 ? (d = c[a + 56 >> 2] | 0, e = (c[f >> 2] | 0) + 4 | 0,
				g = c[d >> 2] | 0, c[g + 4 >> 2] = c[e >> 2], c[c[e >> 2] >> 2] = g, c[b >> 2] = 0,
				(d | 0) != (f | 0)) : 0) do {
					b = d;
					d = c[d + 4 >> 2] | 0;
					cg(b);
				} while ((d | 0) != (f | 0));
			e = c[a + 36 >> 2] | 0;
			d = e;
			if (e) {
				b = a + 40 | 0;
				f = c[b >> 2] | 0;
				if ((f | 0) != (e | 0)) c[b >> 2] = f + (~((f + -4 - d | 0) >>> 2) << 2);
				cg(e);
			}
			f = c[a + 20 >> 2] | 0;
			e = f;
			if (f) {
				d = a + 24 | 0;
				b = c[d >> 2] | 0;
				if ((b | 0) != (f | 0)) c[d >> 2] = b + (~(((b + -12 - e | 0) >>> 0) / 12 | 0) * 12 | 0);
				cg(f);
			}
			e = c[a + 4 >> 2] | 0;
			if (!e) return;
			b = a + 8 | 0;
			d = c[b >> 2] | 0;
			if ((d | 0) != (e | 0)) c[b >> 2] = d + (~(((d + -28 - e | 0) >>> 0) / 28 | 0) * 28 | 0);
			cg(e);
			return;
		}
		function Oe(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0, l = 0;
			g = a + 8 | 0;
			h = c[a >> 2] | 0;
			d = h;
			if ((((c[g >> 2] | 0) - d | 0) / 12 | 0) >>> 0 < b >>> 0) {
				i = a + 4 | 0;
				d = (c[i >> 2] | 0) - d | 0;
				e = (d | 0) / 12 | 0;
				if (!b) f = 0; else f = bg(b * 12 | 0) | 0;
				l = f + ((((d | 0) / -12 | 0) + e | 0) * 12 | 0) | 0;
				bh(l | 0, h | 0, d | 0) | 0;
				c[a >> 2] = l;
				c[i >> 2] = f + (e * 12 | 0);
				c[g >> 2] = f + (b * 12 | 0);
				if (h) cg(h);
			}
			e = b << 1;
			d = a + 20 | 0;
			j = a + 12 | 0;
			k = c[j >> 2] | 0;
			f = k;
			if ((((c[d >> 2] | 0) - f | 0) / 24 | 0) >>> 0 < e >>> 0) {
				l = a + 16 | 0;
				i = (c[l >> 2] | 0) - f | 0;
				h = (i | 0) / 24 | 0;
				if (!e) g = 0; else g = bg(b * 48 | 0) | 0;
				f = g + ((((i | 0) / -24 | 0) + h | 0) * 24 | 0) | 0;
				bh(f | 0, k | 0, i | 0) | 0;
				c[j >> 2] = f;
				c[l >> 2] = g + (h * 24 | 0);
				c[d >> 2] = g + (e * 24 | 0);
				if (k) cg(k);
			}
			l = b * 6 | 0;
			k = a + 32 | 0;
			j = a + 24 | 0;
			e = c[j >> 2] | 0;
			f = e;
			if ((((c[k >> 2] | 0) - f | 0) / 24 | 0) >>> 0 >= l >>> 0) return;
			i = a + 28 | 0;
			h = (c[i >> 2] | 0) - f | 0;
			g = (h | 0) / 24 | 0;
			if (!l) f = 0; else f = bg(b * 144 | 0) | 0;
			a = f + ((((h | 0) / -24 | 0) + g | 0) * 24 | 0) | 0;
			bh(a | 0, e | 0, h | 0) | 0;
			c[j >> 2] = a;
			c[i >> 2] = f + (g * 24 | 0);
			c[k >> 2] = f + (l * 24 | 0);
			if (!e) return;
			cg(e);
			return;
		}
		function Pe(a) {
			a = a | 0;
			var d = 0, e = 0, f = 0, g = 0, h = 0, j = 0, k = 0, l = 0, m = 0, n = 0;
			n = i;
			i = i + 16 | 0;
			e = n;
			m = a + 4 | 0;
			j = c[m >> 2] | 0;
			l = a + 8 | 0;
			f = c[l >> 2] | 0;
			b[e >> 1] = 0;
			Ye(j, f, e);
			e = c[m >> 2] | 0;
			f = c[l >> 2] | 0;
			a: do if ((e | 0) != (f | 0)) {
				g = e + 28 | 0;
				if ((g | 0) != (f | 0)) {
					d = e;
					h = g;
					while (1) {
						if ((((c[d >> 2] | 0) == (c[d + 28 >> 2] | 0) ? (c[d + 4 >> 2] | 0) == (c[d + 32 >> 2] | 0) : 0) ? (c[d + 8 >> 2] | 0) == (c[d + 36 >> 2] | 0) : 0) ? (c[d + 12 >> 2] | 0) == (c[d + 40 >> 2] | 0) : 0) {
							j = d;
							k = 8;
							break a;
						}
						g = d + 56 | 0;
						if ((g | 0) == (f | 0)) break; else {
							d = h;
							h = g;
						}
					}
				}
			} else {
				j = e;
				k = 8;
			} while (0);
			if ((k | 0) == 8) if ((j | 0) != (f | 0)) {
				g = j + 56 | 0;
				if ((g | 0) == (f | 0)) d = j; else {
					d = j;
					h = j;
					j = j + 28 | 0;
					while (1) {
						if (!((((c[d >> 2] | 0) == (c[h + 56 >> 2] | 0) ? (c[d + 4 >> 2] | 0) == (c[h + 60 >> 2] | 0) : 0) ? (c[d + 8 >> 2] | 0) == (c[h + 64 >> 2] | 0) : 0) ? (c[d + 12 >> 2] | 0) == (c[h + 68 >> 2] | 0) : 0)) {
							d = d + 28 | 0;
							c[d + 0 >> 2] = c[g + 0 >> 2];
							c[d + 4 >> 2] = c[g + 4 >> 2];
							c[d + 8 >> 2] = c[g + 8 >> 2];
							c[d + 12 >> 2] = c[g + 12 >> 2];
							c[d + 16 >> 2] = c[g + 16 >> 2];
							c[d + 20 >> 2] = c[g + 20 >> 2];
							c[d + 24 >> 2] = c[g + 24 >> 2];
						}
						e = j + 56 | 0;
						if ((e | 0) == (f | 0)) break; else {
							k = g;
							h = j;
							g = e;
							j = k;
						}
					}
					f = c[l >> 2] | 0;
					e = c[m >> 2] | 0;
				}
				g = d + 28 | 0;
				if ((g | 0) != (f | 0)) {
					k = g;
					e = e + ((((f - k | 0) / 28 | 0) + ((k - e | 0) / 28 | 0) | 0) * 28 | 0) | 0;
					f = f - e | 0;
					ch(g | 0, e | 0, f | 0) | 0;
					f = d + ((((f | 0) / 28 | 0) + 1 | 0) * 28 | 0) | 0;
					e = c[l >> 2] | 0;
					if ((e | 0) != (f | 0)) {
						f = e + (~(((e + -28 - f | 0) >>> 0) / 28 | 0) * 28 | 0) | 0;
						c[l >> 2] = f;
					}
				}
			}
			d = c[m >> 2] | 0;
			if ((f | 0) == (d | 0)) {
				m = f;
				a = a + 16 | 0;
				c[a >> 2] = m;
				i = n;
				return;
			}
			e = (f - d | 0) / 28 | 0;
			f = 0;
			do {
				c[d + (f * 28 | 0) + 16 >> 2] = f;
				f = f + 1 | 0;
			} while (f >>> 0 < e >>> 0);
			a = a + 16 | 0;
			c[a >> 2] = d;
			i = n;
			return;
		}
		function Qe(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0, f = 0, g = 0, h = 0, j = 0, k = 0, l = 0, m = 0, n = 0;
			n = i;
			i = i + 32 | 0;
			m = n + 8 | 0;
			h = n + 4 | 0;
			j = n;
			l = c[a + 4 >> 2] | 0;
			g = c[a + 8 >> 2] | 0;
			if ((l | 0) == (g | 0)) {
				i = n;
				return;
			}
			if ((g - l | 0) == 28) {
				e = c[l + 24 >> 2] & 31;
				c[m >> 2] = c[l + 20 >> 2];
				c[m + 4 >> 2] = 0;
				c[m + 8 >> 2] = e;
				e = b + 4 | 0;
				d = c[e >> 2] | 0;
				if (d >>> 0 < (c[b + 8 >> 2] | 0) >>> 0) {
					if (!d) d = 0; else {
						c[d + 0 >> 2] = c[m + 0 >> 2];
						c[d + 4 >> 2] = c[m + 4 >> 2];
						c[d + 8 >> 2] = c[m + 8 >> 2];
						d = c[e >> 2] | 0;
					}
					c[e >> 2] = d + 12;
				} else Ze(b, m);
				b = a + 16 | 0;
				c[b >> 2] = (c[b >> 2] | 0) + 28;
				i = n;
				return;
			}
			k = a + 16 | 0;
			e = c[k >> 2] | 0;
			if ((e | 0) != (g | 0)) {
				f = c[l >> 2] | 0;
				d = e;
				e = 0;
				do {
					if ((c[d >> 2] | 0) != (f | 0)) break;
					if ((f | 0) != (c[d + 8 >> 2] | 0)) break;
					d = d + 28 | 0;
					c[k >> 2] = d;
					e = e + 1 | 0;
				} while ((d | 0) != (g | 0));
				if ((e | 0) == 1) {
					c[h >> 2] = a + 68;
					c[m + 0 >> 2] = c[h + 0 >> 2];
					_e(j, a, l, l, l + 28 | 0, m, b);
					c[k >> 2] = (c[k >> 2] | 0) + 28;
					i = n;
					return;
				}
			}
			$e(a, b);
			i = n;
			return;
		}
		function Re(b, d) {
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, h = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0, v = 0, w = 0, x = 0, y = 0, z = 0, A = 0, B = 0, C = 0, D = 0, E = 0, F = 0, G = 0, H = 0, I = 0, J = 0, K = 0, L = 0, M = 0, N = 0, O = 0, P = 0, Q = 0, R = 0;
			N = i;
			i = i + 208 | 0;
			D = N + 80 | 0;
			C = N + 40 | 0;
			A = N + 152 | 0;
			r = N + 144 | 0;
			s = N + 140 | 0;
			u = N + 136 | 0;
			v = N + 32 | 0;
			M = N;
			F = N + 132 | 0;
			G = N + 128 | 0;
			H = N + 124 | 0;
			I = N + 120 | 0;
			L = N + 116 | 0;
			J = N + 112 | 0;
			K = b + 16 | 0;
			k = c[K >> 2] | 0;
			c[M + 0 >> 2] = c[k + 0 >> 2];
			c[M + 4 >> 2] = c[k + 4 >> 2];
			c[M + 8 >> 2] = c[k + 8 >> 2];
			c[M + 12 >> 2] = c[k + 12 >> 2];
			c[M + 16 >> 2] = c[k + 16 >> 2];
			c[M + 20 >> 2] = c[k + 20 >> 2];
			c[M + 24 >> 2] = c[k + 24 >> 2];
			e = k + 28 | 0;
			l = c[M >> 2] | 0;
			E = M + 8 | 0;
			if ((l | 0) == (c[E >> 2] | 0) ? (t = M + 4 | 0, (c[t >> 2] | 0) == (c[M + 12 >> 2] | 0)) : 0) {
				f = b + 20 | 0;
				j = c[f >> 2] | 0;
				m = b + 24 | 0;
				k = c[m >> 2] | 0;
				a: do if ((j | 0) != (k | 0)) {
					n = b + 32 | 0;
					o = b + 64 | 0;
					p = b + 72 | 0;
					q = b + 68 | 0;
					h = l;
					while (1) {
						if ((c[j >> 2] | 0) != (h | 0)) break a;
						if ((c[j + 4 >> 2] | 0) != (c[t >> 2] | 0)) break a;
						h = j + 8 | 0;
						l = c[h >> 2] | 0;
						a[v >> 0] = a[n >> 0] | 0;
						g = k - j | 0;
						if ((g | 0) > 12) {
							z = k + -12 | 0;
							x = j;
							B = c[x >> 2] | 0;
							x = c[x + 4 >> 2] | 0;
							P = z;
							O = c[P + 4 >> 2] | 0;
							y = j;
							c[y >> 2] = c[P >> 2];
							c[y + 4 >> 2] = O;
							y = z;
							c[y >> 2] = B;
							c[y + 4 >> 2] = x;
							y = c[h >> 2] | 0;
							k = k + -4 | 0;
							c[h >> 2] = c[k >> 2];
							c[k >> 2] = y;
							c[r >> 2] = j;
							c[s >> 2] = z;
							c[u >> 2] = j;
							c[A + 0 >> 2] = c[r + 0 >> 2];
							c[C + 0 >> 2] = c[s + 0 >> 2];
							c[D + 0 >> 2] = c[u + 0 >> 2];
							af(A, C, v, ((g | 0) / 12 | 0) + -1 | 0, D);
							k = c[m >> 2] | 0;
						}
						c[m >> 2] = k + -12;
						j = c[l + 4 >> 2] | 0;
						if (!j) {
							k = l;
							while (1) {
								j = c[k + 8 >> 2] | 0;
								if ((c[j >> 2] | 0) == (k | 0)) break; else k = j;
							}
						} else while (1) {
							k = c[j >> 2] | 0;
							if (!k) break; else j = k;
						}
						if ((c[o >> 2] | 0) == (l | 0)) c[o >> 2] = j;
						c[p >> 2] = (c[p >> 2] | 0) + -1;
						bf(c[q >> 2] | 0, l);
						cg(l);
						j = c[f >> 2] | 0;
						k = c[m >> 2] | 0;
						if ((j | 0) == (k | 0)) break a;
						h = c[M >> 2] | 0;
					}
				} while (0);
				k = c[K >> 2] | 0;
				j = e;
			} else w = 3;
			b: do if ((w | 0) == 3) {
				j = c[b + 8 >> 2] | 0;
				if ((e | 0) == (j | 0)) j = e; else {
					h = c[M + 4 >> 2] | 0;
					g = k;
					while (1) {
						f = c[g + 28 >> 2] | 0;
						if ((f | 0) == (c[g + 36 >> 2] | 0)) {
							if (!((f | 0) == (l | 0) ? (c[e + 4 >> 2] | 0) != (c[e + 12 >> 2] | 0) : 0)) {
								j = e;
								break b;
							}
						} else if ((f | 0) != (l | 0)) {
							j = e;
							break b;
						}
						f = g + 56 | 0;
						if ((c[g + 32 >> 2] | 0) != (h | 0)) {
							j = e;
							break b;
						}
						if ((f | 0) == (j | 0)) break; else {
							g = e;
							e = f;
						}
					}
				}
			} while (0);
			c[A + 0 >> 2] = c[k + 0 >> 2];
			c[A + 4 >> 2] = c[k + 4 >> 2];
			c[A + 8 >> 2] = c[k + 8 >> 2];
			c[A + 12 >> 2] = c[k + 12 >> 2];
			c[A + 16 >> 2] = c[k + 16 >> 2];
			c[A + 20 >> 2] = c[k + 20 >> 2];
			c[A + 24 >> 2] = c[k + 24 >> 2];
			B = A + 28 | 0;
			c[B + 0 >> 2] = c[k + 0 >> 2];
			c[B + 4 >> 2] = c[k + 4 >> 2];
			c[B + 8 >> 2] = c[k + 8 >> 2];
			c[B + 12 >> 2] = c[k + 12 >> 2];
			c[B + 16 >> 2] = c[k + 16 >> 2];
			c[B + 20 >> 2] = c[k + 20 >> 2];
			c[B + 24 >> 2] = c[k + 24 >> 2];
			B = b + 68 | 0;
			e = c[B >> 2] | 0;
			c: do if (!e) e = B; else {
				h = b + 76 | 0;
				g = B;
				f = e;
				while (1) {
					e = f;
					while (1) {
						if (!(cf(h, e + 16 | 0, A) | 0)) break;
						e = c[e + 4 >> 2] | 0;
						if (!e) {
							e = g;
							break c;
						}
					}
					f = c[e >> 2] | 0;
					if (!f) break; else g = e;
				}
			} while (0);
			if ((k | 0) == (j | 0)) {
				i = N;
				return;
			}
			w = D + 24 | 0;
			v = b + 80 | 0;
			u = b + 36 | 0;
			t = C + 32 | 0;
			s = b + 64 | 0;
			r = M + 4 | 0;
			q = M + 12 | 0;
			p = D + 24 | 0;
			m = C + 32 | 0;
			n = M + 8 | 0;
			o = M + 24 | 0;
			x = D + 24 | 0;
			y = C + 32 | 0;
			z = D + 24 | 0;
			A = C + 32 | 0;
			do {
				c[M + 0 >> 2] = c[k + 0 >> 2];
				c[M + 4 >> 2] = c[k + 4 >> 2];
				c[M + 8 >> 2] = c[k + 8 >> 2];
				c[M + 12 >> 2] = c[k + 12 >> 2];
				c[M + 16 >> 2] = c[k + 16 >> 2];
				c[M + 20 >> 2] = c[k + 20 >> 2];
				c[M + 24 >> 2] = c[k + 24 >> 2];
				do if ((e | 0) == (B | 0)) {
					k = c[B >> 2] | 0;
					if (!k) {
						h = B;
						while (1) {
							k = c[h + 8 >> 2] | 0;
							if ((c[k >> 2] | 0) == (h | 0)) h = k; else break;
						}
					} else while (1) {
						h = c[k + 4 >> 2] | 0;
						if (!h) break; else k = h;
					}
					f = k + 44 | 0;
					c[G >> 2] = B;
					c[D + 0 >> 2] = c[G + 0 >> 2];
					_e(F, b, f, f, M, D, d);
					e = c[F >> 2] | 0;
					a[w >> 0] = 1;
					if (df(v, k + 16 | 0, f, M, D) | 0) {
						c[C + 0 >> 2] = c[D + 0 >> 2];
						c[C + 4 >> 2] = c[D + 4 >> 2];
						c[C + 8 >> 2] = c[D + 8 >> 2];
						c[C + 12 >> 2] = c[D + 12 >> 2];
						c[C + 16 >> 2] = c[D + 16 >> 2];
						c[C + 20 >> 2] = c[D + 20 >> 2];
						c[C + 24 >> 2] = c[D + 24 >> 2];
						c[C + 28 >> 2] = c[D + 28 >> 2];
						c[t >> 2] = e;
						c[e + 72 >> 2] = ef(u, C) | 0;
					}
				} else {
					f = e + 16 | 0;
					if ((e | 0) == (c[s >> 2] | 0)) {
						c[I >> 2] = e;
						c[D + 0 >> 2] = c[I + 0 >> 2];
						_e(H, b, f, f, M, D, d);
						k = c[H >> 2] | 0;
						if (!((c[M >> 2] | 0) == (c[E >> 2] | 0) ? (c[r >> 2] | 0) == (c[q >> 2] | 0) : 0)) {
							h = M;
							l = c[h >> 2] | 0;
							h = c[h + 4 >> 2] | 0;
							P = n;
							O = c[P + 4 >> 2] | 0;
							g = M;
							c[g >> 2] = c[P >> 2];
							c[g + 4 >> 2] = O;
							g = n;
							c[g >> 2] = l;
							c[g + 4 >> 2] = h;
							c[o >> 2] = c[o >> 2] ^ 32;
						}
						a[p >> 0] = 1;
						if (df(v, M, f, e + 44 | 0, D) | 0) {
							c[C + 0 >> 2] = c[D + 0 >> 2];
							c[C + 4 >> 2] = c[D + 4 >> 2];
							c[C + 8 >> 2] = c[D + 8 >> 2];
							c[C + 12 >> 2] = c[D + 12 >> 2];
							c[C + 16 >> 2] = c[D + 16 >> 2];
							c[C + 20 >> 2] = c[D + 20 >> 2];
							c[C + 24 >> 2] = c[D + 24 >> 2];
							c[C + 28 >> 2] = c[D + 28 >> 2];
							c[m >> 2] = e;
							c[e + 72 >> 2] = ef(u, C) | 0;
						}
						e = k;
						break;
					}
					l = e + 44 | 0;
					g = e + 72 | 0;
					k = c[g >> 2] | 0;
					if (k) {
						a[k + 24 >> 0] = 0;
						c[g >> 2] = 0;
					}
					k = c[e >> 2] | 0;
					if (!k) {
						h = e;
						while (1) {
							k = c[h + 8 >> 2] | 0;
							if ((c[k >> 2] | 0) == (h | 0)) h = k; else break;
						}
					} else while (1) {
						h = c[k + 4 >> 2] | 0;
						if (!h) break; else k = h;
					}
					O = k + 44 | 0;
					c[J >> 2] = e;
					c[D + 0 >> 2] = c[J + 0 >> 2];
					_e(L, b, O, f, M, D, d);
					h = c[L >> 2] | 0;
					a[x >> 0] = 1;
					if (df(v, k + 16 | 0, O, M, D) | 0) {
						c[C + 0 >> 2] = c[D + 0 >> 2];
						c[C + 4 >> 2] = c[D + 4 >> 2];
						c[C + 8 >> 2] = c[D + 8 >> 2];
						c[C + 12 >> 2] = c[D + 12 >> 2];
						c[C + 16 >> 2] = c[D + 16 >> 2];
						c[C + 20 >> 2] = c[D + 20 >> 2];
						c[C + 24 >> 2] = c[D + 24 >> 2];
						c[C + 28 >> 2] = c[D + 28 >> 2];
						c[y >> 2] = h;
						c[h + 72 >> 2] = ef(u, C) | 0;
					}
					if (!((c[M >> 2] | 0) == (c[E >> 2] | 0) ? (c[r >> 2] | 0) == (c[q >> 2] | 0) : 0)) {
						O = M;
						P = c[O >> 2] | 0;
						O = c[O + 4 >> 2] | 0;
						R = n;
						Q = c[R + 4 >> 2] | 0;
						k = M;
						c[k >> 2] = c[R >> 2];
						c[k + 4 >> 2] = Q;
						k = n;
						c[k >> 2] = P;
						c[k + 4 >> 2] = O;
						c[o >> 2] = c[o >> 2] ^ 32;
					}
					a[z >> 0] = 1;
					if (df(v, M, f, l, D) | 0) {
						c[C + 0 >> 2] = c[D + 0 >> 2];
						c[C + 4 >> 2] = c[D + 4 >> 2];
						c[C + 8 >> 2] = c[D + 8 >> 2];
						c[C + 12 >> 2] = c[D + 12 >> 2];
						c[C + 16 >> 2] = c[D + 16 >> 2];
						c[C + 20 >> 2] = c[D + 20 >> 2];
						c[C + 24 >> 2] = c[D + 24 >> 2];
						c[C + 28 >> 2] = c[D + 28 >> 2];
						c[A >> 2] = e;
						c[g >> 2] = ef(u, C) | 0;
						e = c[L >> 2] | 0;
					} else e = h;
				} while (0);
				k = (c[K >> 2] | 0) + 28 | 0;
				c[K >> 2] = k;
			} while ((k | 0) != (j | 0));
			i = N;
			return;
		}
		function Se(e, f) {
			e = e | 0;
			f = f | 0;
			var g = 0, h = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0, v = 0, w = 0, x = 0, y = 0, z = 0, A = 0, B = 0, C = 0, D = 0, E = 0, F = 0;
			D = i;
			i = i + 176 | 0;
			z = D + 80 | 0;
			y = D + 40 | 0;
			s = D + 160 | 0;
			t = D + 156 | 0;
			u = D + 152 | 0;
			v = D + 148 | 0;
			w = D + 32 | 0;
			C = D;
			B = D + 120 | 0;
			o = D + 112 | 0;
			A = e + 36 | 0;
			r = c[c[A >> 2] >> 2] | 0;
			q = r + 8 | 0;
			r = c[r + 40 >> 2] | 0;
			n = r + 44 | 0;
			c[C + 0 >> 2] = c[n + 0 >> 2];
			c[C + 4 >> 2] = c[n + 4 >> 2];
			c[C + 8 >> 2] = c[n + 8 >> 2];
			c[C + 12 >> 2] = c[n + 12 >> 2];
			c[C + 16 >> 2] = c[n + 16 >> 2];
			c[C + 20 >> 2] = c[n + 20 >> 2];
			c[C + 24 >> 2] = c[n + 24 >> 2];
			n = c[r + 76 >> 2] | 0;
			g = c[r >> 2] | 0;
			if (!g) {
				j = r;
				while (1) {
					g = c[j + 8 >> 2] | 0;
					if ((c[g >> 2] | 0) == (j | 0)) j = g; else break;
				}
			} else while (1) {
				j = c[g + 4 >> 2] | 0;
				if (!j) break; else g = j;
			}
			k = g + 16 | 0;
			x = g + 72 | 0;
			m = x + 4 | 0;
			l = c[m >> 2] | 0;
			c[B + 0 >> 2] = c[k + 0 >> 2];
			c[B + 4 >> 2] = c[k + 4 >> 2];
			c[B + 8 >> 2] = c[k + 8 >> 2];
			c[B + 12 >> 2] = c[k + 12 >> 2];
			c[B + 16 >> 2] = c[k + 16 >> 2];
			c[B + 20 >> 2] = c[k + 20 >> 2];
			c[B + 24 >> 2] = c[k + 24 >> 2];
			k = c[B >> 2] | 0;
			do if ((k | 0) == (c[B + 8 >> 2] | 0) ? (p = c[B + 4 >> 2] | 0, (p | 0) == (c[B + 12 >> 2] | 0)) : 0) {
				j = c[C + 8 >> 2] | 0;
				if ((c[C >> 2] | 0) == (j | 0) ? (c[C + 4 >> 2] | 0) == (c[C + 12 >> 2] | 0) : 0) break;
				h = C + 8 | 0;
				if ((j | 0) == (k | 0) ? (c[C + 12 >> 2] | 0) == (p | 0) : 0) {
					j = C;
					k = c[j >> 2] | 0;
					j = c[j + 4 >> 2] | 0;
					F = h;
					E = c[F + 4 >> 2] | 0;
					p = C;
					c[p >> 2] = c[F >> 2];
					c[p + 4 >> 2] = E;
					c[h >> 2] = k;
					c[h + 4 >> 2] = j;
					h = C + 24 | 0;
					c[h >> 2] = c[h >> 2] ^ 32;
				}
			} while (0);
			j = g + 44 | 0;
			c[j + 0 >> 2] = c[C + 0 >> 2];
			c[j + 4 >> 2] = c[C + 4 >> 2];
			c[j + 8 >> 2] = c[C + 8 >> 2];
			c[j + 12 >> 2] = c[C + 12 >> 2];
			c[j + 16 >> 2] = c[C + 16 >> 2];
			c[j + 20 >> 2] = c[C + 20 >> 2];
			c[j + 24 >> 2] = c[C + 24 >> 2];
			ff(o, f, B, C, q, l, n);
			c[m >> 2] = c[o >> 2];
			n = e + 64 | 0;
			j = c[r + 4 >> 2] | 0;
			if (!j) {
				h = r;
				while (1) {
					j = c[h + 8 >> 2] | 0;
					if ((c[j >> 2] | 0) == (h | 0)) break; else h = j;
				}
			} else while (1) {
				h = c[j >> 2] | 0;
				if (!h) break; else j = h;
			}
			if ((c[n >> 2] | 0) == (r | 0)) c[n >> 2] = j;
			h = e + 72 | 0;
			c[h >> 2] = (c[h >> 2] | 0) + -1;
			bf(c[e + 68 >> 2] | 0, r);
			cg(r);
			h = c[A >> 2] | 0;
			l = c[h >> 2] | 0;
			m = e + 40 | 0;
			j = c[m >> 2] | 0;
			k = e + 48 | 0;
			b[w >> 1] = d[k >> 0] | d[k + 1 >> 0] << 8;
			k = j - h | 0;
			if ((k | 0) > 4) {
				j = j + -4 | 0;
				c[h >> 2] = c[j >> 2];
				c[j >> 2] = l;
				c[t >> 2] = h;
				c[u >> 2] = j;
				c[v >> 2] = h;
				c[s + 0 >> 2] = c[t + 0 >> 2];
				c[y + 0 >> 2] = c[u + 0 >> 2];
				c[z + 0 >> 2] = c[v + 0 >> 2];
				Te(s, y, w, (k >> 2) + -1 | 0, z);
				j = c[m >> 2] | 0;
			}
			c[m >> 2] = j + -4;
			w = l + 4 | 0;
			v = c[l >> 2] | 0;
			c[v + 4 >> 2] = c[w >> 2];
			c[c[w >> 2] >> 2] = v;
			w = e + 60 | 0;
			c[w >> 2] = (c[w >> 2] | 0) + -1;
			cg(l);
			if ((g | 0) != (c[n >> 2] | 0)) {
				h = c[x >> 2] | 0;
				if (h) {
					a[h + 24 >> 0] = 0;
					c[x >> 2] = 0;
				}
				h = c[g >> 2] | 0;
				if (!h) {
					j = g;
					while (1) {
						h = c[j + 8 >> 2] | 0;
						if ((c[h >> 2] | 0) == (j | 0)) j = h; else break;
					}
				} else while (1) {
					j = c[h + 4 >> 2] | 0;
					if (!j) break; else h = j;
				}
				a[z + 24 >> 0] = 1;
				if (df(e + 80 | 0, h + 16 | 0, B, C, z) | 0) {
					c[y + 0 >> 2] = c[z + 0 >> 2];
					c[y + 4 >> 2] = c[z + 4 >> 2];
					c[y + 8 >> 2] = c[z + 8 >> 2];
					c[y + 12 >> 2] = c[z + 12 >> 2];
					c[y + 16 >> 2] = c[z + 16 >> 2];
					c[y + 20 >> 2] = c[z + 20 >> 2];
					c[y + 24 >> 2] = c[z + 24 >> 2];
					c[y + 28 >> 2] = c[z + 28 >> 2];
					c[y + 32 >> 2] = g;
					c[x >> 2] = ef(A, y) | 0;
				}
			}
			h = c[g + 4 >> 2] | 0;
			if (!h) while (1) {
				h = c[g + 8 >> 2] | 0;
				if ((c[h >> 2] | 0) == (g | 0)) {
					g = h;
					break;
				} else g = h;
			} else {
				g = h;
				while (1) {
					h = c[g >> 2] | 0;
					if (!h) break; else g = h;
				}
			}
			if ((g | 0) == (e + 68 | 0)) {
				i = D;
				return;
			}
			h = g + 72 | 0;
			j = c[h >> 2] | 0;
			if (j) {
				a[j + 24 >> 0] = 0;
				c[h >> 2] = 0;
			}
			a[z + 24 >> 0] = 1;
			if (df(e + 80 | 0, B, C, g + 44 | 0, z) | 0) {
				c[y + 0 >> 2] = c[z + 0 >> 2];
				c[y + 4 >> 2] = c[z + 4 >> 2];
				c[y + 8 >> 2] = c[z + 8 >> 2];
				c[y + 12 >> 2] = c[z + 12 >> 2];
				c[y + 16 >> 2] = c[z + 16 >> 2];
				c[y + 20 >> 2] = c[z + 20 >> 2];
				c[y + 24 >> 2] = c[z + 24 >> 2];
				c[y + 28 >> 2] = c[z + 28 >> 2];
				c[y + 32 >> 2] = g;
				c[h >> 2] = ef(A, y) | 0;
			}
			i = D;
			return;
		}
		function Te(a, b, d, e, f) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			var g = 0, i = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0;
			n = c[f >> 2] | 0;
			q = c[a >> 2] | 0;
			b = n - q | 0;
			if ((e | 0) < 2) return;
			r = (e + -2 | 0) / 2 | 0;
			if ((r | 0) < (b >> 2 | 0)) return;
			l = b >> 1 | 1;
			i = q + (l << 2) | 0;
			a = l + 1 | 0;
			do if ((a | 0) < (e | 0)) {
				d = q + (a << 2) | 0;
				b = c[i >> 2] | 0;
				j = c[d >> 2] | 0;
				g = +h[j + 24 >> 3];
				k = +h[b + 24 >> 3];
				if (g != k) {
					if (!(g < k)) {
						d = i;
						a = l;
						break;
					}
				} else if (!(+h[j + 16 >> 3] < +h[b + 16 >> 3])) {
					d = i;
					a = l;
					break;
				}
			} else {
				d = i;
				a = l;
			} while (0);
			j = c[d >> 2] | 0;
			p = c[n >> 2] | 0;
			o = +h[p + 24 >> 3];
			g = +h[j + 24 >> 3];
			do if (o != g) if (o < g) return; else {
				b = p + 16 | 0;
				break;
			} else {
				b = p + 16 | 0;
				if (+h[b >> 3] < +h[j + 16 >> 3]) return;
			} while (0);
			c[n >> 2] = j;
			c[f >> 2] = d;
			a: do if ((r | 0) >= (a | 0)) {
				n = d;
				while (1) {
					m = a << 1 | 1;
					l = q + (m << 2) | 0;
					a = m + 1 | 0;
					do if ((a | 0) < (e | 0)) {
						d = q + (a << 2) | 0;
						j = c[l >> 2] | 0;
						i = c[d >> 2] | 0;
						k = +h[i + 24 >> 3];
						g = +h[j + 24 >> 3];
						if (k != g) {
							if (!(k < g)) {
								d = l;
								a = m;
								break;
							}
						} else if (!(+h[i + 16 >> 3] < +h[j + 16 >> 3])) {
							d = l;
							a = m;
							break;
						}
					} else {
						d = l;
						a = m;
					} while (0);
					i = c[d >> 2] | 0;
					g = +h[i + 24 >> 3];
					if (o != g) {
						if (o < g) {
							d = n;
							break a;
						}
					} else if (+h[b >> 3] < +h[i + 16 >> 3]) {
						d = n;
						break a;
					}
					c[n >> 2] = i;
					c[f >> 2] = d;
					if ((r | 0) < (a | 0)) break; else n = d;
				}
			} while (0);
			c[d >> 2] = p;
			return;
		}
		function Ue(a, b) {
			a = a | 0;
			b = b | 0;
			if (!b) return; else {
				Ue(a, c[b >> 2] | 0);
				Ue(a, c[b + 4 >> 2] | 0);
				cg(b);
				return;
			}
		}
		function Ve(a) {
			a = a | 0;
			var b = 0, d = 0, e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0;
			l = a + 24 | 0;
			e = c[l >> 2] | 0;
			m = a + 28 | 0;
			if ((e | 0) != (c[m >> 2] | 0)) {
				f = e;
				do {
					j = c[e + 4 >> 2] | 0;
					k = c[e + 8 >> 2] | 0;
					i = c[k + 4 >> 2] | 0;
					if ((j | 0) != 0 & (i | 0) != 0) {
						g = j;
						h = c[g >> 2] | 0;
						g = c[g + 4 >> 2] | 0;
						b = i;
						d = c[b >> 2] | 0;
						b = c[b + 4 >> 2] | 0;
						o = (g | 0) > -1 | (g | 0) == -1 & h >>> 0 > 4294967295;
						p = Xg(0, -2147483648, h | 0, g | 0) | 0;
						h = o ? p : h;
						g = o ? D : g;
						o = (b | 0) > -1 | (b | 0) == -1 & d >>> 0 > 4294967295;
						p = Xg(0, -2147483648, d | 0, b | 0) | 0;
						d = o ? p : d;
						b = o ? D : b;
						if (g >>> 0 > b >>> 0 | (g | 0) == (b | 0) & h >>> 0 > d >>> 0) {
							g = Xg(h | 0, g | 0, d | 0, b | 0) | 0;
							h = D;
							g = (h >>> 0 > 0 | (h | 0) == 0 & g >>> 0 > 128) << 31 >> 31;
						} else {
							g = Xg(d | 0, b | 0, h | 0, g | 0) | 0;
							h = D;
							g = (h >>> 0 > 0 | (h | 0) == 0 & g >>> 0 > 128) & 1;
						}
						if (!g) {
							g = j + 8 | 0;
							h = c[g >> 2] | 0;
							g = c[g + 4 >> 2] | 0;
							b = i + 8 | 0;
							d = c[b >> 2] | 0;
							b = c[b + 4 >> 2] | 0;
							i = (g | 0) > -1 | (g | 0) == -1 & h >>> 0 > 4294967295;
							o = Xg(0, -2147483648, h | 0, g | 0) | 0;
							h = i ? o : h;
							g = i ? D : g;
							i = (b | 0) > -1 | (b | 0) == -1 & d >>> 0 > 4294967295;
							o = Xg(0, -2147483648, d | 0, b | 0) | 0;
							d = i ? o : d;
							b = i ? D : b;
							if (g >>> 0 > b >>> 0 | (g | 0) == (b | 0) & h >>> 0 > d >>> 0) {
								g = Xg(h | 0, g | 0, d | 0, b | 0) | 0;
								i = D;
								g = (i >>> 0 > 0 | (i | 0) == 0 & g >>> 0 > 128) << 31 >> 31;
							} else {
								g = Xg(d | 0, b | 0, h | 0, g | 0) | 0;
								i = D;
								g = (i >>> 0 > 0 | (i | 0) == 0 & g >>> 0 > 128) & 1;
							}
							if (!g) {
								d = c[(c[k + 16 >> 2] | 0) + 8 >> 2] | 0;
								if ((d | 0) == (k | 0)) d = k; else {
									g = d;
									do {
										c[g + 4 >> 2] = j;
										g = c[(c[g + 16 >> 2] | 0) + 8 >> 2] | 0;
									} while ((g | 0) != (k | 0));
								}
								j = c[k + 12 >> 2] | 0;
								k = c[(c[k + 8 >> 2] | 0) + 12 >> 2] | 0;
								i = c[(c[(c[e + 16 >> 2] | 0) + 8 >> 2] | 0) + 8 >> 2] | 0;
								c[i + 12 >> 2] = k;
								c[k + 16 >> 2] = i;
								k = c[d + 8 >> 2] | 0;
								c[j + 16 >> 2] = k;
								c[k + 12 >> 2] = j;
							} else n = 14;
						} else n = 14;
					} else n = 14;
					if ((n | 0) == 14) {
						n = 0;
						if ((e | 0) != (f | 0)) {
							c[f + 0 >> 2] = c[e + 0 >> 2];
							c[f + 4 >> 2] = c[e + 4 >> 2];
							c[f + 8 >> 2] = c[e + 8 >> 2];
							c[f + 12 >> 2] = c[e + 12 >> 2];
							c[f + 16 >> 2] = c[e + 16 >> 2];
							c[f + 20 >> 2] = c[e + 20 >> 2];
							g = f + 24 | 0;
							d = e + 24 | 0;
							c[g + 0 >> 2] = c[d + 0 >> 2];
							c[g + 4 >> 2] = c[d + 4 >> 2];
							c[g + 8 >> 2] = c[d + 8 >> 2];
							c[g + 12 >> 2] = c[d + 12 >> 2];
							c[g + 16 >> 2] = c[d + 16 >> 2];
							c[g + 20 >> 2] = c[d + 20 >> 2];
							c[f + 8 >> 2] = g;
							c[f + 32 >> 2] = f;
							d = c[f + 16 >> 2] | 0;
							if (d) {
								c[d + 12 >> 2] = f;
								c[(c[f + 36 >> 2] | 0) + 16 >> 2] = g;
							}
							d = f + 40 | 0;
							if (c[d >> 2] | 0) {
								c[(c[f + 12 >> 2] | 0) + 16 >> 2] = f;
								c[(c[d >> 2] | 0) + 12 >> 2] = g;
							}
						}
						f = f + 48 | 0;
					}
					e = e + 48 | 0;
				} while ((e | 0) != (c[m >> 2] | 0));
				d = f;
				f = c[l >> 2] | 0;
				if ((d | 0) != (e | 0)) {
					k = d;
					k = f + ((((e - k | 0) / 24 | 0) + ((k - f | 0) / 24 | 0) | 0) * 24 | 0) | 0;
					e = e - k | 0;
					ch(d | 0, k | 0, e | 0) | 0;
					e = d + (((e | 0) / 24 | 0) * 24 | 0) | 0;
					d = c[m >> 2] | 0;
					if ((d | 0) != (e | 0)) {
						e = d + (~(((d + -24 - e | 0) >>> 0) / 24 | 0) * 24 | 0) | 0;
						c[m >> 2] = e;
					}
				}
			}
			d = c[l >> 2] | 0;
			if ((d | 0) != (e | 0)) do {
				c[(c[d >> 2] | 0) + 4 >> 2] = d;
				f = c[d + 4 >> 2] | 0;
				if (f) c[f + 16 >> 2] = d;
				d = d + 24 | 0;
			} while ((d | 0) != (e | 0));
			d = a + 12 | 0;
			g = c[d >> 2] | 0;
			h = a + 16 | 0;
			e = c[h >> 2] | 0;
			if ((g | 0) != (e | 0)) {
				i = g;
				do {
					if (c[i + 16 >> 2] | 0) {
						if ((i | 0) != (g | 0)) {
							c[g + 0 >> 2] = c[i + 0 >> 2];
							c[g + 4 >> 2] = c[i + 4 >> 2];
							c[g + 8 >> 2] = c[i + 8 >> 2];
							c[g + 12 >> 2] = c[i + 12 >> 2];
							c[g + 16 >> 2] = c[i + 16 >> 2];
							c[g + 20 >> 2] = c[i + 20 >> 2];
							f = c[g + 16 >> 2] | 0;
							e = f;
							do {
								c[e + 4 >> 2] = g;
								e = c[(c[e + 16 >> 2] | 0) + 8 >> 2] | 0;
							} while ((e | 0) != (f | 0));
						}
						e = c[h >> 2] | 0;
						g = g + 24 | 0;
					}
					i = i + 24 | 0;
				} while ((i | 0) != (e | 0));
				f = c[d >> 2] | 0;
				if ((g | 0) != (e | 0)) {
					k = g;
					f = f + ((((e - k | 0) / 24 | 0) + ((k - f | 0) / 24 | 0) | 0) * 24 | 0) | 0;
					e = e - f | 0;
					ch(g | 0, f | 0, e | 0) | 0;
					e = g + (((e | 0) / 24 | 0) * 24 | 0) | 0;
					f = c[h >> 2] | 0;
					if ((f | 0) != (e | 0)) {
						e = f + (~(((f + -24 - e | 0) >>> 0) / 24 | 0) * 24 | 0) | 0;
						c[h >> 2] = e;
					}
				}
			} else e = g;
			if ((c[d >> 2] | 0) == (e | 0)) {
				f = c[l >> 2] | 0;
				e = c[m >> 2] | 0;
				if ((f | 0) == (e | 0)) return;
				c[f + 12 >> 2] = f;
				c[f + 16 >> 2] = f;
				b = f + 24 | 0;
				d = f + 48 | 0;
				if ((d | 0) == (e | 0)) d = f; else {
					g = c[m >> 2] | 0;
					e = b;
					while (1) {
						b = f + 72 | 0;
						c[f + 36 >> 2] = d;
						c[f + 40 >> 2] = d;
						c[f + 60 >> 2] = e;
						c[f + 64 >> 2] = e;
						e = f + 96 | 0;
						if ((e | 0) == (g | 0)) break; else {
							f = d;
							d = e;
							e = b;
						}
					}
				}
				c[d + 36 >> 2] = b;
				c[d + 40 >> 2] = b;
				return;
			}
			e = c[a >> 2] | 0;
			i = c[a + 4 >> 2] | 0;
			if ((e | 0) == (i | 0)) return;
			do {
				b = c[e + 4 >> 2] | 0;
				do if (b) {
					f = b;
					while (1) {
						d = f;
						f = c[f + 16 >> 2] | 0;
						if (!f) break;
						if ((f | 0) == (b | 0)) {
							n = 48;
							break;
						}
					}
					if ((n | 0) == 48) {
						n = 0;
						if (!(c[b + 16 >> 2] | 0)) d = b; else break;
					}
					h = d + 16 | 0;
					f = b;
					while (1) {
						b = f + 12 | 0;
						g = c[b >> 2] | 0;
						if (!g) break; else f = g;
					}
					c[h >> 2] = f;
					c[b >> 2] = d;
				} while (0);
				e = e + 12 | 0;
			} while ((e | 0) != (i | 0));
			return;
		}
		function We(b, d, e) {
			b = b | 0;
			d = d | 0;
			e = e | 0;
			var f = 0, h = 0, i = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0;
			m = c[e + 8 >> 2] | 0;
			i = $(m, 1540483477) | 0;
			i = ($(i >>> 24 ^ i, 1540483477) | 0) ^ 1866966612;
			i = $(i >>> 13 ^ i, 1540483477) | 0;
			i = i >>> 15 ^ i;
			r = e + 4 | 0;
			c[r >> 2] = i;
			q = d + 4 | 0;
			l = c[q >> 2] | 0;
			p = (l | 0) == 0;
			a: do if (!p) {
				n = l + -1 | 0;
				o = (n & l | 0) == 0;
				if (o) h = i & n; else h = (i >>> 0) % (l >>> 0) | 0;
				f = c[(c[d >> 2] | 0) + (h << 2) >> 2] | 0;
				if (!f) f = h; else {
					while (1) {
						f = c[f >> 2] | 0;
						if (!f) {
							f = h;
							break a;
						}
						i = c[f + 4 >> 2] | 0;
						if (o) i = i & n; else i = (i >>> 0) % (l >>> 0) | 0;
						if ((i | 0) != (h | 0)) {
							f = h;
							break a;
						}
						if ((c[f + 8 >> 2] | 0) == (m | 0)) {
							h = 0;
							break;
						}
					}
					q = f;
					c[b >> 2] = q;
					q = b + 4 | 0;
					a[q >> 0] = h;
					return;
				}
			} else f = 0; while (0);
			o = d + 12 | 0;
			j = +(((c[o >> 2] | 0) + 1 | 0) >>> 0);
			k = +g[d + 16 >> 2];
			do if (p | j > +(l >>> 0) * k) {
				if (l >>> 0 > 2) i = (l + -1 & l | 0) == 0; else i = 0;
				i = (i & 1 | l << 1) ^ 1;
				h = ~~+_(+(j / k)) >>> 0;
				gf(d, i >>> 0 < h >>> 0 ? h : i);
				i = c[q >> 2] | 0;
				h = c[r >> 2] | 0;
				f = i + -1 | 0;
				if (!(f & i)) {
					l = i;
					f = f & h;
					break;
				} else {
					l = i;
					f = (h >>> 0) % (i >>> 0) | 0;
					break;
				}
			} while (0);
			h = c[(c[d >> 2] | 0) + (f << 2) >> 2] | 0;
			if (!h) {
				h = d + 8 | 0;
				c[e >> 2] = c[h >> 2];
				c[h >> 2] = e;
				c[(c[d >> 2] | 0) + (f << 2) >> 2] = h;
				h = c[e >> 2] | 0;
				if (h) {
					h = c[h + 4 >> 2] | 0;
					f = l + -1 | 0;
					if (!(f & l)) h = h & f; else h = (h >>> 0) % (l >>> 0) | 0;
					c[(c[d >> 2] | 0) + (h << 2) >> 2] = e;
				}
			} else {
				c[e >> 2] = c[h >> 2];
				c[h >> 2] = e;
			}
			c[o >> 2] = (c[o >> 2] | 0) + 1;
			p = 1;
			q = e;
			c[b >> 2] = q;
			q = b + 4 | 0;
			a[q >> 0] = p;
			return;
		}
		function Xe(b, d, e) {
			b = b | 0;
			d = d | 0;
			e = e | 0;
			var f = 0, h = 0, i = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0;
			m = c[e + 8 >> 2] | 0;
			i = $(m, 1540483477) | 0;
			i = ($(i >>> 24 ^ i, 1540483477) | 0) ^ 1866966612;
			i = $(i >>> 13 ^ i, 1540483477) | 0;
			i = i >>> 15 ^ i;
			r = e + 4 | 0;
			c[r >> 2] = i;
			q = d + 4 | 0;
			l = c[q >> 2] | 0;
			p = (l | 0) == 0;
			a: do if (!p) {
				n = l + -1 | 0;
				o = (n & l | 0) == 0;
				if (o) h = i & n; else h = (i >>> 0) % (l >>> 0) | 0;
				f = c[(c[d >> 2] | 0) + (h << 2) >> 2] | 0;
				if (!f) f = h; else {
					while (1) {
						f = c[f >> 2] | 0;
						if (!f) {
							f = h;
							break a;
						}
						i = c[f + 4 >> 2] | 0;
						if (o) i = i & n; else i = (i >>> 0) % (l >>> 0) | 0;
						if ((i | 0) != (h | 0)) {
							f = h;
							break a;
						}
						if ((c[f + 8 >> 2] | 0) == (m | 0)) {
							h = 0;
							break;
						}
					}
					q = f;
					c[b >> 2] = q;
					q = b + 4 | 0;
					a[q >> 0] = h;
					return;
				}
			} else f = 0; while (0);
			o = d + 12 | 0;
			j = +(((c[o >> 2] | 0) + 1 | 0) >>> 0);
			k = +g[d + 16 >> 2];
			do if (p | j > +(l >>> 0) * k) {
				if (l >>> 0 > 2) i = (l + -1 & l | 0) == 0; else i = 0;
				i = (i & 1 | l << 1) ^ 1;
				h = ~~+_(+(j / k)) >>> 0;
				hf(d, i >>> 0 < h >>> 0 ? h : i);
				i = c[q >> 2] | 0;
				h = c[r >> 2] | 0;
				f = i + -1 | 0;
				if (!(f & i)) {
					l = i;
					f = f & h;
					break;
				} else {
					l = i;
					f = (h >>> 0) % (i >>> 0) | 0;
					break;
				}
			} while (0);
			h = c[(c[d >> 2] | 0) + (f << 2) >> 2] | 0;
			if (!h) {
				h = d + 8 | 0;
				c[e >> 2] = c[h >> 2];
				c[h >> 2] = e;
				c[(c[d >> 2] | 0) + (f << 2) >> 2] = h;
				h = c[e >> 2] | 0;
				if (h) {
					h = c[h + 4 >> 2] | 0;
					f = l + -1 | 0;
					if (!(f & l)) h = h & f; else h = (h >>> 0) % (l >>> 0) | 0;
					c[(c[d >> 2] | 0) + (h << 2) >> 2] = e;
				}
			} else {
				c[e >> 2] = c[h >> 2];
				c[h >> 2] = e;
			}
			c[o >> 2] = (c[o >> 2] | 0) + 1;
			p = 1;
			q = e;
			c[b >> 2] = q;
			q = b + 4 | 0;
			a[q >> 0] = p;
			return;
		}
		function Ye(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, h = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0, v = 0, w = 0, x = 0, y = 0, z = 0, A = 0, B = 0, C = 0, D = 0, E = 0, F = 0, G = 0, H = 0, I = 0, J = 0, K = 0, L = 0, M = 0, N = 0, O = 0;
			O = i;
			i = i + 32 | 0;
			M = O;
			a: while (1) {
				z = b;
				K = b + -28 | 0;
				A = b + -56 | 0;
				g = b + -20 | 0;
				h = b + -24 | 0;
				f = b + -16 | 0;
				j = b + -20 | 0;
				b: while (1) {
					y = a;
					l = z - y | 0;
					switch ((l | 0) / 28 | 0 | 0) {
						case 5:
							{
								b = K;
								N = 22;
								break a;
							}

						case 4:
							{
								b = K;
								N = 21;
								break a;
							}

						case 2:
							{
								l = K;
								e = K;
								k = K;
								N = 4;
								break a;
							}

						case 3:
							{
								b = K;
								N = 20;
								break a;
							}

						case 1:
						case 0:
							{
								N = 193;
								break a;
							}

						default:
							{ }
					}
					if ((l | 0) < 868) {
						N = 24;
						break a;
					}
					q = (l | 0) / 56 | 0;
					n = a + (q * 28 | 0) | 0;
					if ((l | 0) > 27972) {
						l = (l | 0) / 112 | 0;
						l = mf(a, a + (l * 28 | 0) | 0, n, a + ((l + q | 0) * 28 | 0) | 0, K, d) | 0;
					} else l = kf(a, n, K, d) | 0;
					x = c[a >> 2] | 0;
					w = c[n >> 2] | 0;
					do if ((x | 0) == (w | 0)) {
						m = (x | 0) == (c[a + 8 >> 2] | 0);
						if (m ? (J = c[a + 4 >> 2] | 0, (J | 0) == (c[a + 12 >> 2] | 0)) : 0) {
							if ((x | 0) != (c[a + (q * 28 | 0) + 8 >> 2] | 0)) {
								m = K;
								break;
							}
							m = c[a + (q * 28 | 0) + 4 >> 2] | 0;
							if ((m | 0) == (c[a + (q * 28 | 0) + 12 >> 2] | 0)) if ((J | 0) < (m | 0)) {
								m = K;
								break;
							} else {
								N = 43;
								break;
							} else if ((J | 0) > (m | 0)) {
								N = 43;
								break;
							} else {
								m = K;
								break;
							}
						}
						if ((x | 0) == (c[a + (q * 28 | 0) + 8 >> 2] | 0)) {
							if (!m) {
								N = 43;
								break;
							}
							if ((c[a + 4 >> 2] | 0) < (c[a + (q * 28 | 0) + 4 >> 2] | 0)) {
								m = K;
								break;
							} else {
								N = 43;
								break;
							}
						}
						if (!m) {
							m = c[a + 4 >> 2] | 0;
							k = c[a + (q * 28 | 0) + 4 >> 2] | 0;
							if ((m | 0) == (k | 0)) if ((jf(a + 8 | 0, a, a + (q * 28 | 0) + 8 | 0) | 0) == 1) {
								m = K;
								break;
							} else {
								N = 43;
								break;
							} else if ((m | 0) < (k | 0)) {
								m = K;
								break;
							} else {
								N = 43;
								break;
							}
						} else m = K;
					} else if ((x | 0) < (w | 0)) m = K; else N = 43; while (0);
					c: do if ((N | 0) == 43) {
						N = 0;
						d: do if ((a | 0) != (A | 0)) {
							t = a + (q * 28 | 0) + 8 | 0;
							u = a + (q * 28 | 0) + 4 | 0;
							v = a + (q * 28 | 0) + 12 | 0;
							r = a + (q * 28 | 0) + 8 | 0;
							o = b;
							k = A;
							s = K;
							e: while (1) {
								e = c[o + -56 >> 2] | 0;
								do if ((e | 0) == (w | 0)) {
									e = (w | 0) == (c[o + -48 >> 2] | 0);
									if (e ? (F = c[o + -52 >> 2] | 0, (F | 0) == (c[o + -44 >> 2] | 0)) : 0) {
										if ((w | 0) != (c[t >> 2] | 0)) break e;
										m = c[u >> 2] | 0;
										if ((m | 0) == (c[v >> 2] | 0)) if ((F | 0) < (m | 0)) break e; else break; else if ((F | 0) > (m | 0)) break; else break e;
									}
									if ((w | 0) == (c[t >> 2] | 0)) {
										if (!e) break;
										if ((c[o + -52 >> 2] | 0) < (c[u >> 2] | 0)) break e; else break;
									}
									if (e) break e;
									q = c[o + -52 >> 2] | 0;
									p = c[u >> 2] | 0;
									if ((q | 0) == (p | 0)) if ((jf(o + -48 | 0, o + -56 | 0, r) | 0) == 1) break e; else break; else if ((q | 0) < (p | 0)) break e; else break;
								} else if ((e | 0) < (w | 0)) break e; while (0);
								m = s + -56 | 0;
								if ((a | 0) == (m | 0)) break d; else {
									q = k;
									o = s;
									k = m;
									s = q;
								}
							}
							c[M + 0 >> 2] = c[a + 0 >> 2];
							c[M + 4 >> 2] = c[a + 4 >> 2];
							c[M + 8 >> 2] = c[a + 8 >> 2];
							c[M + 12 >> 2] = c[a + 12 >> 2];
							c[M + 16 >> 2] = c[a + 16 >> 2];
							c[M + 20 >> 2] = c[a + 20 >> 2];
							c[M + 24 >> 2] = c[a + 24 >> 2];
							c[a + 0 >> 2] = c[k + 0 >> 2];
							c[a + 4 >> 2] = c[k + 4 >> 2];
							c[a + 8 >> 2] = c[k + 8 >> 2];
							c[a + 12 >> 2] = c[k + 12 >> 2];
							c[a + 16 >> 2] = c[k + 16 >> 2];
							c[a + 20 >> 2] = c[k + 20 >> 2];
							c[a + 24 >> 2] = c[k + 24 >> 2];
							c[k + 0 >> 2] = c[M + 0 >> 2];
							c[k + 4 >> 2] = c[M + 4 >> 2];
							c[k + 8 >> 2] = c[M + 8 >> 2];
							c[k + 12 >> 2] = c[M + 12 >> 2];
							c[k + 16 >> 2] = c[M + 16 >> 2];
							c[k + 20 >> 2] = c[M + 20 >> 2];
							c[k + 24 >> 2] = c[M + 24 >> 2];
							m = k;
							l = l + 1 | 0;
							break c;
						} while (0);
						l = a + 28 | 0;
						k = c[K >> 2] | 0;
						do if ((x | 0) == (k | 0)) {
							k = (x | 0) == (c[a + 8 >> 2] | 0);
							if (k ? (B = c[a + 4 >> 2] | 0, (B | 0) == (c[a + 12 >> 2] | 0)) : 0) {
								if ((x | 0) != (c[g >> 2] | 0)) break;
								k = c[h >> 2] | 0;
								if ((k | 0) == (c[f >> 2] | 0)) if ((B | 0) < (k | 0)) break; else {
									N = 60;
									break;
								} else if ((B | 0) > (k | 0)) {
									N = 60;
									break;
								} else break;
							}
							if ((x | 0) == (c[g >> 2] | 0)) {
								if (!k) {
									N = 60;
									break;
								}
								if ((c[a + 4 >> 2] | 0) < (c[h >> 2] | 0)) break; else {
									N = 60;
									break;
								}
							}
							if (!k) {
								k = c[a + 4 >> 2] | 0;
								e = c[h >> 2] | 0;
								if ((k | 0) == (e | 0)) if ((jf(a + 8 | 0, a, j) | 0) == 1) break; else {
									N = 60;
									break;
								} else if ((k | 0) < (e | 0)) break; else {
									N = 60;
									break;
								}
							}
						} else if ((x | 0) >= (k | 0)) N = 60; while (0);
						if ((N | 0) == 60) {
							N = 0;
							if ((l | 0) == (K | 0)) {
								N = 193;
								break a;
							}
							o = a + 8 | 0;
							e = a + 4 | 0;
							p = a + 12 | 0;
							q = a + 8 | 0;
							n = a;
							f: while (1) {
								m = c[l >> 2] | 0;
								do if ((x | 0) == (m | 0)) {
									m = (x | 0) == (c[o >> 2] | 0);
									if (m ? (C = c[e >> 2] | 0, (C | 0) == (c[p >> 2] | 0)) : 0) {
										if ((x | 0) != (c[l + 8 >> 2] | 0)) break f;
										m = c[l + 4 >> 2] | 0;
										if ((m | 0) == (c[l + 12 >> 2] | 0)) if ((C | 0) < (m | 0)) break f; else break; else if ((C | 0) > (m | 0)) break; else break f;
									}
									if ((x | 0) == (c[l + 8 >> 2] | 0)) {
										if (!m) break;
										if ((c[e >> 2] | 0) < (c[l + 4 >> 2] | 0)) break f; else break;
									}
									if (m) break f;
									m = c[e >> 2] | 0;
									k = c[l + 4 >> 2] | 0;
									if ((m | 0) == (k | 0)) if ((jf(q, a, l + 8 | 0) | 0) == 1) break f; else break; else if ((m | 0) < (k | 0)) break f; else break;
								} else if ((x | 0) < (m | 0)) break f; while (0);
								m = n + 56 | 0;
								if ((m | 0) == (K | 0)) {
									N = 193;
									break a;
								} else {
									n = l;
									l = m;
								}
							}
							c[M + 0 >> 2] = c[l + 0 >> 2];
							c[M + 4 >> 2] = c[l + 4 >> 2];
							c[M + 8 >> 2] = c[l + 8 >> 2];
							c[M + 12 >> 2] = c[l + 12 >> 2];
							c[M + 16 >> 2] = c[l + 16 >> 2];
							c[M + 20 >> 2] = c[l + 20 >> 2];
							c[M + 24 >> 2] = c[l + 24 >> 2];
							c[l + 0 >> 2] = c[K + 0 >> 2];
							c[l + 4 >> 2] = c[K + 4 >> 2];
							c[l + 8 >> 2] = c[K + 8 >> 2];
							c[l + 12 >> 2] = c[K + 12 >> 2];
							c[l + 16 >> 2] = c[K + 16 >> 2];
							c[l + 20 >> 2] = c[K + 20 >> 2];
							c[l + 24 >> 2] = c[K + 24 >> 2];
							c[K + 0 >> 2] = c[M + 0 >> 2];
							c[K + 4 >> 2] = c[M + 4 >> 2];
							c[K + 8 >> 2] = c[M + 8 >> 2];
							c[K + 12 >> 2] = c[M + 12 >> 2];
							c[K + 16 >> 2] = c[M + 16 >> 2];
							c[K + 20 >> 2] = c[M + 20 >> 2];
							c[K + 24 >> 2] = c[M + 24 >> 2];
							l = l + 28 | 0;
						}
						if ((l | 0) == (K | 0)) {
							N = 193;
							break a;
						}
						u = a + 8 | 0;
						t = a + 4 | 0;
						s = a + 8 | 0;
						r = a + 12 | 0;
						m = K;
						while (1) {
							v = c[a >> 2] | 0;
							g: while (1) {
								k = c[l >> 2] | 0;
								if ((v | 0) == (k | 0)) {
									k = (v | 0) == (c[s >> 2] | 0);
									if (k ? (D = c[t >> 2] | 0, (D | 0) == (c[r >> 2] | 0)) : 0) {
										if ((v | 0) != (c[l + 8 >> 2] | 0)) break g;
										k = c[l + 4 >> 2] | 0;
										if ((k | 0) == (c[l + 12 >> 2] | 0)) if ((D | 0) < (k | 0)) break g; else break; else if ((D | 0) > (k | 0)) break; else break g;
									}
									if ((v | 0) == (c[l + 8 >> 2] | 0)) {
										if (!k) break;
										if ((c[t >> 2] | 0) < (c[l + 4 >> 2] | 0)) break g; else break;
									}
									if (k) break g;
									k = c[t >> 2] | 0;
									e = c[l + 4 >> 2] | 0;
									if ((k | 0) == (e | 0)) if ((jf(u, a, l + 8 | 0) | 0) == 1) break g; else break; else if ((k | 0) < (e | 0)) break g; else break;
								} else if ((v | 0) < (k | 0)) break g;
								l = l + 28 | 0;
							}
							while (1) {
								n = m + -28 | 0;
								k = c[n >> 2] | 0;
								if ((v | 0) != (k | 0)) if ((v | 0) < (k | 0)) {
									m = n;
									continue;
								} else {
									m = n;
									break;
								}
								k = (v | 0) == (c[s >> 2] | 0);
								if (k ? (E = c[t >> 2] | 0, (E | 0) == (c[r >> 2] | 0)) : 0) {
									if ((v | 0) != (c[m + -20 >> 2] | 0)) {
										m = n;
										continue;
									}
									k = c[m + -24 >> 2] | 0;
									if ((k | 0) == (c[m + -16 >> 2] | 0)) if ((E | 0) < (k | 0)) {
										m = n;
										continue;
									} else {
										m = n;
										break;
									} else if ((E | 0) > (k | 0)) {
										m = n;
										break;
									} else {
										m = n;
										continue;
									}
								}
								if ((v | 0) == (c[m + -20 >> 2] | 0)) {
									if (!k) {
										m = n;
										break;
									}
									if ((c[t >> 2] | 0) < (c[m + -24 >> 2] | 0)) {
										m = n;
										continue;
									} else {
										m = n;
										break;
									}
								}
								if (k) {
									m = n;
									continue;
								}
								k = c[t >> 2] | 0;
								e = c[m + -24 >> 2] | 0;
								if ((k | 0) == (e | 0)) if ((jf(u, a, m + -20 | 0) | 0) == 1) {
									m = n;
									continue;
								} else {
									m = n;
									break;
								} else if ((k | 0) < (e | 0)) {
									m = n;
									continue;
								} else {
									m = n;
									break;
								}
							}
							if (l >>> 0 >= m >>> 0) {
								a = l;
								continue b;
							}
							c[M + 0 >> 2] = c[l + 0 >> 2];
							c[M + 4 >> 2] = c[l + 4 >> 2];
							c[M + 8 >> 2] = c[l + 8 >> 2];
							c[M + 12 >> 2] = c[l + 12 >> 2];
							c[M + 16 >> 2] = c[l + 16 >> 2];
							c[M + 20 >> 2] = c[l + 20 >> 2];
							c[M + 24 >> 2] = c[l + 24 >> 2];
							c[l + 0 >> 2] = c[m + 0 >> 2];
							c[l + 4 >> 2] = c[m + 4 >> 2];
							c[l + 8 >> 2] = c[m + 8 >> 2];
							c[l + 12 >> 2] = c[m + 12 >> 2];
							c[l + 16 >> 2] = c[m + 16 >> 2];
							c[l + 20 >> 2] = c[m + 20 >> 2];
							c[l + 24 >> 2] = c[m + 24 >> 2];
							c[m + 0 >> 2] = c[M + 0 >> 2];
							c[m + 4 >> 2] = c[M + 4 >> 2];
							c[m + 8 >> 2] = c[M + 8 >> 2];
							c[m + 12 >> 2] = c[M + 12 >> 2];
							c[m + 16 >> 2] = c[M + 16 >> 2];
							c[m + 20 >> 2] = c[M + 20 >> 2];
							c[m + 24 >> 2] = c[M + 24 >> 2];
							l = l + 28 | 0;
						}
					} while (0);
					k = a + 28 | 0;
					h: do if (k >>> 0 < m >>> 0) {
						q = k;
						v = m;
						while (1) {
							w = c[n >> 2] | 0;
							u = n + 8 | 0;
							t = n + 4 | 0;
							s = n + 12 | 0;
							r = n + 8 | 0;
							k = q;
							i: while (1) {
								m = c[k >> 2] | 0;
								do if ((m | 0) == (w | 0)) {
									m = (w | 0) == (c[k + 8 >> 2] | 0);
									if (m ? (G = c[k + 4 >> 2] | 0, (G | 0) == (c[k + 12 >> 2] | 0)) : 0) {
										if ((w | 0) != (c[u >> 2] | 0)) break;
										m = c[t >> 2] | 0;
										if ((m | 0) == (c[s >> 2] | 0)) if ((G | 0) < (m | 0)) break; else break i; else if ((G | 0) > (m | 0)) break i; else break;
									}
									if ((w | 0) == (c[u >> 2] | 0)) {
										if (!m) break i;
										if ((c[k + 4 >> 2] | 0) < (c[t >> 2] | 0)) break; else break i;
									}
									if (!m) {
										m = c[k + 4 >> 2] | 0;
										e = c[t >> 2] | 0;
										if ((m | 0) == (e | 0)) if ((jf(k + 8 | 0, k, r) | 0) == 1) break; else break i; else if ((m | 0) < (e | 0)) break; else break i;
									}
								} else if ((m | 0) >= (w | 0)) break i; while (0);
								k = k + 28 | 0;
							}
							q = v;
							while (1) {
								m = q + -28 | 0;
								e = c[m >> 2] | 0;
								if ((e | 0) != (w | 0)) if ((e | 0) < (w | 0)) break; else {
									q = m;
									continue;
								}
								e = (w | 0) == (c[q + -20 >> 2] | 0);
								if (e ? (H = c[q + -24 >> 2] | 0, (H | 0) == (c[q + -16 >> 2] | 0)) : 0) {
									if ((w | 0) != (c[u >> 2] | 0)) break;
									e = c[t >> 2] | 0;
									if ((e | 0) == (c[s >> 2] | 0)) if ((H | 0) < (e | 0)) break; else {
										q = m;
										continue;
									} else if ((H | 0) > (e | 0)) {
										q = m;
										continue;
									} else break;
								}
								if ((w | 0) == (c[u >> 2] | 0)) {
									if (!e) {
										q = m;
										continue;
									}
									if ((c[q + -24 >> 2] | 0) < (c[t >> 2] | 0)) break; else {
										q = m;
										continue;
									}
								}
								if (e) break;
								e = c[q + -24 >> 2] | 0;
								o = c[t >> 2] | 0;
								if ((e | 0) == (o | 0)) if ((jf(q + -20 | 0, m, r) | 0) == 1) break; else {
									q = m;
									continue;
								} else if ((e | 0) < (o | 0)) break; else {
									q = m;
									continue;
								}
							}
							if (k >>> 0 > m >>> 0) break h;
							c[M + 0 >> 2] = c[k + 0 >> 2];
							c[M + 4 >> 2] = c[k + 4 >> 2];
							c[M + 8 >> 2] = c[k + 8 >> 2];
							c[M + 12 >> 2] = c[k + 12 >> 2];
							c[M + 16 >> 2] = c[k + 16 >> 2];
							c[M + 20 >> 2] = c[k + 20 >> 2];
							c[M + 24 >> 2] = c[k + 24 >> 2];
							c[k + 0 >> 2] = c[m + 0 >> 2];
							c[k + 4 >> 2] = c[m + 4 >> 2];
							c[k + 8 >> 2] = c[m + 8 >> 2];
							c[k + 12 >> 2] = c[m + 12 >> 2];
							c[k + 16 >> 2] = c[m + 16 >> 2];
							c[k + 20 >> 2] = c[m + 20 >> 2];
							c[k + 24 >> 2] = c[m + 24 >> 2];
							c[m + 0 >> 2] = c[M + 0 >> 2];
							c[m + 4 >> 2] = c[M + 4 >> 2];
							c[m + 8 >> 2] = c[M + 8 >> 2];
							c[m + 12 >> 2] = c[M + 12 >> 2];
							c[m + 16 >> 2] = c[M + 16 >> 2];
							c[m + 20 >> 2] = c[M + 20 >> 2];
							c[m + 24 >> 2] = c[M + 24 >> 2];
							q = k + 28 | 0;
							v = m;
							n = (n | 0) == (k | 0) ? m : n;
							l = l + 1 | 0;
						}
					} while (0);
					j: do if ((k | 0) != (n | 0)) {
						m = c[n >> 2] | 0;
						e = c[k >> 2] | 0;
						do if ((m | 0) == (e | 0)) {
							e = (m | 0) == (c[n + 8 >> 2] | 0);
							if (e ? (I = c[n + 4 >> 2] | 0, (I | 0) == (c[n + 12 >> 2] | 0)) : 0) {
								if ((m | 0) != (c[k + 8 >> 2] | 0)) break;
								e = c[k + 4 >> 2] | 0;
								if ((e | 0) == (c[k + 12 >> 2] | 0)) if ((I | 0) < (e | 0)) break; else break j; else if ((I | 0) > (e | 0)) break j; else break;
							}
							if ((m | 0) == (c[k + 8 >> 2] | 0)) {
								if (!e) break j;
								if ((c[n + 4 >> 2] | 0) < (c[k + 4 >> 2] | 0)) break; else break j;
							}
							if (!e) {
								e = c[n + 4 >> 2] | 0;
								m = c[k + 4 >> 2] | 0;
								if ((e | 0) == (m | 0)) if ((jf(n + 8 | 0, n, k + 8 | 0) | 0) == 1) break; else break j; else if ((e | 0) < (m | 0)) break; else break j;
							}
						} else if ((m | 0) >= (e | 0)) break j; while (0);
						c[M + 0 >> 2] = c[k + 0 >> 2];
						c[M + 4 >> 2] = c[k + 4 >> 2];
						c[M + 8 >> 2] = c[k + 8 >> 2];
						c[M + 12 >> 2] = c[k + 12 >> 2];
						c[M + 16 >> 2] = c[k + 16 >> 2];
						c[M + 20 >> 2] = c[k + 20 >> 2];
						c[M + 24 >> 2] = c[k + 24 >> 2];
						c[k + 0 >> 2] = c[n + 0 >> 2];
						c[k + 4 >> 2] = c[n + 4 >> 2];
						c[k + 8 >> 2] = c[n + 8 >> 2];
						c[k + 12 >> 2] = c[n + 12 >> 2];
						c[k + 16 >> 2] = c[n + 16 >> 2];
						c[k + 20 >> 2] = c[n + 20 >> 2];
						c[k + 24 >> 2] = c[n + 24 >> 2];
						c[n + 0 >> 2] = c[M + 0 >> 2];
						c[n + 4 >> 2] = c[M + 4 >> 2];
						c[n + 8 >> 2] = c[M + 8 >> 2];
						c[n + 12 >> 2] = c[M + 12 >> 2];
						c[n + 16 >> 2] = c[M + 16 >> 2];
						c[n + 20 >> 2] = c[M + 20 >> 2];
						c[n + 24 >> 2] = c[M + 24 >> 2];
						l = l + 1 | 0;
					} while (0);
					if (!l) {
						l = of(a, k, d) | 0;
						e = k + 28 | 0;
						if (of(e, b, d) | 0) {
							N = 188;
							break;
						}
						if (l) {
							a = e;
							continue;
						}
					}
					x = k;
					if ((x - y | 0) >= (z - x | 0)) {
						N = 192;
						break;
					}
					Ye(a, k, d);
					a = k + 28 | 0;
				}
				if ((N | 0) == 188) {
					N = 0;
					if (l) {
						N = 193;
						break;
					} else {
						b = k;
						continue;
					}
				} else if ((N | 0) == 192) {
					N = 0;
					Ye(k + 28 | 0, b, d);
					b = k;
					continue;
				}
			}
			if ((N | 0) == 4) {
				b = c[e >> 2] | 0;
				e = c[a >> 2] | 0;
				do if ((b | 0) == (e | 0)) {
					e = (b | 0) == (c[g >> 2] | 0);
					if (e ? (L = c[h >> 2] | 0, (L | 0) == (c[f >> 2] | 0)) : 0) {
						if ((b | 0) != (c[a + 8 >> 2] | 0)) break;
						b = c[a + 4 >> 2] | 0;
						if ((b | 0) == (c[a + 12 >> 2] | 0)) {
							if ((L | 0) < (b | 0)) break;
							i = O;
							return;
						} else {
							if ((L | 0) <= (b | 0)) break;
							i = O;
							return;
						}
					}
					if ((b | 0) == (c[a + 8 >> 2] | 0)) {
						if (!e) {
							i = O;
							return;
						}
						if ((c[h >> 2] | 0) < (c[a + 4 >> 2] | 0)) break;
						i = O;
						return;
					}
					if (!e) {
						b = c[h >> 2] | 0;
						e = c[a + 4 >> 2] | 0;
						if ((b | 0) == (e | 0)) {
							if ((jf(j, l, a + 8 | 0) | 0) == 1) break;
							i = O;
							return;
						} else {
							if ((b | 0) < (e | 0)) break;
							i = O;
							return;
						}
					}
				} else if ((b | 0) >= (e | 0)) {
					i = O;
					return;
				} while (0);
				c[M + 0 >> 2] = c[a + 0 >> 2];
				c[M + 4 >> 2] = c[a + 4 >> 2];
				c[M + 8 >> 2] = c[a + 8 >> 2];
				c[M + 12 >> 2] = c[a + 12 >> 2];
				c[M + 16 >> 2] = c[a + 16 >> 2];
				c[M + 20 >> 2] = c[a + 20 >> 2];
				c[M + 24 >> 2] = c[a + 24 >> 2];
				c[a + 0 >> 2] = c[k + 0 >> 2];
				c[a + 4 >> 2] = c[k + 4 >> 2];
				c[a + 8 >> 2] = c[k + 8 >> 2];
				c[a + 12 >> 2] = c[k + 12 >> 2];
				c[a + 16 >> 2] = c[k + 16 >> 2];
				c[a + 20 >> 2] = c[k + 20 >> 2];
				c[a + 24 >> 2] = c[k + 24 >> 2];
				c[k + 0 >> 2] = c[M + 0 >> 2];
				c[k + 4 >> 2] = c[M + 4 >> 2];
				c[k + 8 >> 2] = c[M + 8 >> 2];
				c[k + 12 >> 2] = c[M + 12 >> 2];
				c[k + 16 >> 2] = c[M + 16 >> 2];
				c[k + 20 >> 2] = c[M + 20 >> 2];
				c[k + 24 >> 2] = c[M + 24 >> 2];
				i = O;
				return;
			} else if ((N | 0) == 20) {
				kf(a, a + 28 | 0, b, d) | 0;
				i = O;
				return;
			} else if ((N | 0) == 21) {
				lf(a, a + 28 | 0, a + 56 | 0, b, d) | 0;
				i = O;
				return;
			} else if ((N | 0) == 22) {
				mf(a, a + 28 | 0, a + 56 | 0, a + 84 | 0, b, d) | 0;
				i = O;
				return;
			} else if ((N | 0) == 24) {
				nf(a, b, d);
				i = O;
				return;
			} else if ((N | 0) == 193) {
				i = O;
				return;
			}
		}
		function Ze(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0, l = 0, m = 0;
			k = a + 4 | 0;
			l = c[a >> 2] | 0;
			e = (((c[k >> 2] | 0) - l | 0) / 12 | 0) + 1 | 0;
			if (e >>> 0 > 357913941) $f(a);
			m = a + 8 | 0;
			f = l;
			d = ((c[m >> 2] | 0) - f | 0) / 12 | 0;
			if (d >>> 0 < 178956970) {
				d = d << 1;
				e = d >>> 0 < e >>> 0 ? e : d;
				d = (c[k >> 2] | 0) - f | 0;
				f = (d | 0) / 12 | 0;
				if (!e) {
					i = 0;
					h = 0;
					g = f;
					e = d;
				} else j = 6;
			} else {
				d = (c[k >> 2] | 0) - f | 0;
				e = 357913941;
				f = (d | 0) / 12 | 0;
				j = 6;
			}
			if ((j | 0) == 6) {
				i = e;
				h = bg(e * 12 | 0) | 0;
				g = f;
				e = d;
			}
			f = h + (g * 12 | 0) | 0;
			if (f) {
				c[f + 0 >> 2] = c[b + 0 >> 2];
				c[f + 4 >> 2] = c[b + 4 >> 2];
				c[f + 8 >> 2] = c[b + 8 >> 2];
			}
			j = h + ((((e | 0) / -12 | 0) + g | 0) * 12 | 0) | 0;
			bh(j | 0, l | 0, e | 0) | 0;
			c[a >> 2] = j;
			c[k >> 2] = h + ((g + 1 | 0) * 12 | 0);
			c[m >> 2] = h + (i * 12 | 0);
			if (!l) return;
			cg(l);
			return;
		}
		function _e(a, b, d, e, f, g, h) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			g = g | 0;
			h = h | 0;
			var j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0, v = 0, w = 0, x = 0, y = 0, z = 0, A = 0, B = 0, C = 0, D = 0, E = 0, F = 0, G = 0;
			F = i;
			i = i + 160 | 0;
			C = F + 152 | 0;
			E = F + 148 | 0;
			D = F + 144 | 0;
			B = F + 88 | 0;
			r = F + 48 | 0;
			z = F + 80 | 0;
			v = F + 16 | 0;
			y = F;
			c[B + 0 >> 2] = c[d + 0 >> 2];
			c[B + 4 >> 2] = c[d + 4 >> 2];
			c[B + 8 >> 2] = c[d + 8 >> 2];
			c[B + 12 >> 2] = c[d + 12 >> 2];
			c[B + 16 >> 2] = c[d + 16 >> 2];
			c[B + 20 >> 2] = c[d + 20 >> 2];
			c[B + 24 >> 2] = c[d + 24 >> 2];
			l = B + 28 | 0;
			c[l + 0 >> 2] = c[f + 0 >> 2];
			c[l + 4 >> 2] = c[f + 4 >> 2];
			c[l + 8 >> 2] = c[f + 8 >> 2];
			c[l + 12 >> 2] = c[f + 12 >> 2];
			c[l + 16 >> 2] = c[f + 16 >> 2];
			c[l + 20 >> 2] = c[f + 20 >> 2];
			c[l + 24 >> 2] = c[f + 24 >> 2];
			l = f;
			j = c[l >> 2] | 0;
			l = c[l + 4 >> 2] | 0;
			x = f + 8 | 0;
			k = x;
			q = c[k >> 2] | 0;
			k = c[k + 4 >> 2] | 0;
			s = f + 16 | 0;
			n = s;
			d = c[n >> 2] | 0;
			n = c[n + 4 >> 2] | 0;
			t = f + 24 | 0;
			m = c[t >> 2] | 0;
			c[r + 0 >> 2] = c[e + 0 >> 2];
			c[r + 4 >> 2] = c[e + 4 >> 2];
			c[r + 8 >> 2] = c[e + 8 >> 2];
			c[r + 12 >> 2] = c[e + 12 >> 2];
			c[r + 16 >> 2] = c[e + 16 >> 2];
			c[r + 20 >> 2] = c[e + 20 >> 2];
			c[r + 24 >> 2] = c[e + 24 >> 2];
			u = f + 8 | 0;
			if ((j | 0) == (q | 0) ? (c[f + 4 >> 2] | 0) == (c[f + 12 >> 2] | 0) : 0) {
				o = j;
				p = l;
				j = m;
			} else {
				o = q;
				p = k;
				q = j;
				k = l;
				j = m ^ 32;
			}
			pf(z, h, e, f);
			A = b + 64 | 0;
			m = c[g >> 2] | 0;
			h = c[z + 4 >> 2] | 0;
			l = bg(80) | 0;
			e = l + 16 | 0;
			G = e;
			c[G >> 2] = o;
			c[G + 4 >> 2] = p;
			o = l + 24 | 0;
			c[o >> 2] = q;
			c[o + 4 >> 2] = k;
			q = l + 32 | 0;
			c[q >> 2] = d;
			c[q + 4 >> 2] = n;
			c[l + 40 >> 2] = j;
			n = l + 44 | 0;
			c[n + 0 >> 2] = c[r + 0 >> 2];
			c[n + 4 >> 2] = c[r + 4 >> 2];
			c[n + 8 >> 2] = c[r + 8 >> 2];
			c[n + 12 >> 2] = c[r + 12 >> 2];
			c[n + 16 >> 2] = c[r + 16 >> 2];
			c[n + 20 >> 2] = c[r + 20 >> 2];
			c[n + 24 >> 2] = c[r + 24 >> 2];
			n = l + 72 | 0;
			c[n >> 2] = 0;
			c[n + 4 >> 2] = h;
			c[D >> 2] = m;
			c[C + 0 >> 2] = c[D + 0 >> 2];
			n = qf(A, C, E, e) | 0;
			e = c[n >> 2] | 0;
			if (e) {
				if ((e | 0) != (l | 0)) cg(l);
			} else {
				e = c[E >> 2] | 0;
				c[l >> 2] = 0;
				c[l + 4 >> 2] = 0;
				c[l + 8 >> 2] = e;
				c[n >> 2] = l;
				e = c[c[A >> 2] >> 2] | 0;
				if (!e) e = l; else {
					c[A >> 2] = e;
					e = c[n >> 2] | 0;
				}
				rf(c[b + 68 >> 2] | 0, e);
				e = b + 72 | 0;
				c[e >> 2] = (c[e >> 2] | 0) + 1;
				e = l;
			}
			c[g >> 2] = e;
			if ((c[f >> 2] | 0) == (c[u >> 2] | 0) ? (c[f + 4 >> 2] | 0) == (c[f + 12 >> 2] | 0) : 0) d = e; else w = 12;
			do if ((w | 0) == 12) {
				c[v + 0 >> 2] = c[f + 0 >> 2];
				c[v + 4 >> 2] = c[f + 4 >> 2];
				c[v + 8 >> 2] = c[f + 8 >> 2];
				c[v + 12 >> 2] = c[f + 12 >> 2];
				c[v + 16 >> 2] = c[f + 16 >> 2];
				c[v + 20 >> 2] = c[f + 20 >> 2];
				c[v + 24 >> 2] = c[f + 24 >> 2];
				r = f;
				q = c[r >> 2] | 0;
				r = c[r + 4 >> 2] | 0;
				j = x;
				l = c[j >> 2] | 0;
				j = c[j + 4 >> 2] | 0;
				f = s;
				u = c[f >> 2] | 0;
				f = c[f + 4 >> 2] | 0;
				k = c[t >> 2] ^ 32;
				d = bg(80) | 0;
				h = d + 16 | 0;
				c[h + 0 >> 2] = c[v + 0 >> 2];
				c[h + 4 >> 2] = c[v + 4 >> 2];
				c[h + 8 >> 2] = c[v + 8 >> 2];
				c[h + 12 >> 2] = c[v + 12 >> 2];
				c[h + 16 >> 2] = c[v + 16 >> 2];
				c[h + 20 >> 2] = c[v + 20 >> 2];
				c[h + 24 >> 2] = c[v + 24 >> 2];
				w = d + 44 | 0;
				c[w >> 2] = l;
				c[w + 4 >> 2] = j;
				w = d + 52 | 0;
				c[w >> 2] = q;
				c[w + 4 >> 2] = r;
				w = d + 60 | 0;
				c[w >> 2] = u;
				c[w + 4 >> 2] = f;
				c[d + 68 >> 2] = k;
				k = d + 72 | 0;
				c[k >> 2] = 0;
				c[k + 4 >> 2] = 0;
				c[D >> 2] = e;
				c[C + 0 >> 2] = c[D + 0 >> 2];
				h = qf(A, C, E, h) | 0;
				k = c[h >> 2] | 0;
				if (k) if ((k | 0) == (d | 0)) d = k; else {
					cg(d);
					d = k;
				} else {
					k = c[E >> 2] | 0;
					c[d >> 2] = 0;
					c[d + 4 >> 2] = 0;
					c[d + 8 >> 2] = k;
					c[h >> 2] = d;
					k = c[c[A >> 2] >> 2] | 0;
					if (!k) k = d; else {
						c[A >> 2] = k;
						k = c[h >> 2] | 0;
					}
					rf(c[b + 68 >> 2] | 0, k);
					w = b + 72 | 0;
					c[w >> 2] = (c[w >> 2] | 0) + 1;
				}
				c[g >> 2] = d;
				m = b + 20 | 0;
				k = c[x + 4 >> 2] | 0;
				h = y;
				c[h >> 2] = c[x >> 2];
				c[h + 4 >> 2] = k;
				c[y + 8 >> 2] = d;
				h = b + 24 | 0;
				k = c[h >> 2] | 0;
				if (k >>> 0 < (c[b + 28 >> 2] | 0) >>> 0) {
					if (!k) k = 0; else {
						c[k + 0 >> 2] = c[y + 0 >> 2];
						c[k + 4 >> 2] = c[y + 4 >> 2];
						c[k + 8 >> 2] = c[y + 8 >> 2];
						k = c[h >> 2] | 0;
					}
					l = k + 12 | 0;
					c[h >> 2] = l;
				} else {
					sf(m, y);
					l = c[h >> 2] | 0;
				}
				q = c[m >> 2] | 0;
				y = l - q | 0;
				j = (y | 0) / 12 | 0;
				if ((y | 0) > 12) {
					e = (j + -2 | 0) / 2 | 0;
					k = q + (e * 12 | 0) | 0;
					n = l + -12 | 0;
					h = c[n >> 2] | 0;
					m = c[k >> 2] | 0;
					if ((h | 0) == (m | 0)) {
						if ((c[l + -8 >> 2] | 0) >= (c[q + (e * 12 | 0) + 4 >> 2] | 0)) break;
					} else if ((h | 0) >= (m | 0)) break;
					p = n;
					o = c[p >> 2] | 0;
					p = c[p + 4 >> 2] | 0;
					y = l + -4 | 0;
					l = c[y >> 2] | 0;
					v = k;
					w = c[v + 4 >> 2] | 0;
					x = n;
					c[x >> 2] = c[v >> 2];
					c[x + 4 >> 2] = w;
					c[y >> 2] = c[q + (e * 12 | 0) + 8 >> 2];
					a: do if ((j + -1 | 0) >>> 0 >= 3) while (1) {
						d = e;
						e = (e + -1 | 0) / 2 | 0;
						h = q + (e * 12 | 0) | 0;
						m = c[h >> 2] | 0;
						if ((o | 0) == (m | 0)) {
							if ((p | 0) >= (c[q + (e * 12 | 0) + 4 >> 2] | 0)) break a;
						} else if ((o | 0) >= (m | 0)) break a;
						w = h;
						x = c[w + 4 >> 2] | 0;
						y = k;
						c[y >> 2] = c[w >> 2];
						c[y + 4 >> 2] = x;
						c[q + (d * 12 | 0) + 8 >> 2] = c[q + (e * 12 | 0) + 8 >> 2];
						if (d >>> 0 < 3) {
							k = h;
							break;
						} else k = h;
					} while (0);
					d = k;
					c[d >> 2] = o;
					c[d + 4 >> 2] = p;
					c[k + 8 >> 2] = l;
					d = c[g >> 2] | 0;
				}
			} while (0);
			l = c[z >> 2] | 0;
			e = bg(80) | 0;
			m = e + 16 | 0;
			h = m + 0 | 0;
			k = B + 0 | 0;
			j = h + 56 | 0;
			do {
				c[h >> 2] = c[k >> 2];
				h = h + 4 | 0;
				k = k + 4 | 0;
			} while ((h | 0) < (j | 0));
			k = e + 72 | 0;
			c[k >> 2] = 0;
			c[k + 4 >> 2] = l;
			c[D >> 2] = d;
			c[C + 0 >> 2] = c[D + 0 >> 2];
			k = qf(A, C, E, m) | 0;
			j = c[k >> 2] | 0;
			if (!j) {
				j = c[E >> 2] | 0;
				c[e >> 2] = 0;
				c[e + 4 >> 2] = 0;
				c[e + 8 >> 2] = j;
				c[k >> 2] = e;
				j = c[c[A >> 2] >> 2] | 0;
				if (!j) j = e; else {
					c[A >> 2] = j;
					j = c[k >> 2] | 0;
				}
				rf(c[b + 68 >> 2] | 0, j);
				z = b + 72 | 0;
				c[z >> 2] = (c[z >> 2] | 0) + 1;
				z = e;
				c[a >> 2] = z;
				i = F;
				return;
			} else {
				if ((j | 0) == (e | 0)) {
					z = j;
					c[a >> 2] = z;
					i = F;
					return;
				}
				cg(e);
				z = j;
				c[a >> 2] = z;
				i = F;
				return;
			}
		}
		function $e(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0, f = 0, g = 0, h = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0, v = 0, w = 0, x = 0;
			x = i;
			i = i + 80 | 0;
			n = x + 72 | 0;
			v = x + 68 | 0;
			o = x + 64 | 0;
			w = x + 8 | 0;
			p = x;
			e = c[a + 4 >> 2] | 0;
			d = e + 28 | 0;
			s = a + 16 | 0;
			if ((d | 0) == (c[s >> 2] | 0)) {
				i = x;
				return;
			}
			t = w + 28 | 0;
			u = a + 64 | 0;
			q = a + 68 | 0;
			r = a + 68 | 0;
			l = a + 72 | 0;
			m = e;
			k = e;
			while (1) {
				c[w + 0 >> 2] = c[m + 0 >> 2];
				c[w + 4 >> 2] = c[m + 4 >> 2];
				c[w + 8 >> 2] = c[m + 8 >> 2];
				c[w + 12 >> 2] = c[m + 12 >> 2];
				c[w + 16 >> 2] = c[m + 16 >> 2];
				c[w + 20 >> 2] = c[m + 20 >> 2];
				c[w + 24 >> 2] = c[m + 24 >> 2];
				c[t + 0 >> 2] = c[d + 0 >> 2];
				c[t + 4 >> 2] = c[d + 4 >> 2];
				c[t + 8 >> 2] = c[d + 8 >> 2];
				c[t + 12 >> 2] = c[d + 12 >> 2];
				c[t + 16 >> 2] = c[d + 16 >> 2];
				c[t + 20 >> 2] = c[d + 20 >> 2];
				c[t + 24 >> 2] = c[d + 24 >> 2];
				pf(p, b, m, d);
				f = c[p >> 2] | 0;
				a = bg(80) | 0;
				e = a + 16 | 0;
				g = e + 0 | 0;
				h = w + 0 | 0;
				j = g + 56 | 0;
				do {
					c[g >> 2] = c[h >> 2];
					g = g + 4 | 0;
					h = h + 4 | 0;
				} while ((g | 0) < (j | 0));
				j = a + 72 | 0;
				c[j >> 2] = 0;
				c[j + 4 >> 2] = f;
				c[o >> 2] = q;
				c[n + 0 >> 2] = c[o + 0 >> 2];
				f = qf(u, n, v, e) | 0;
				e = c[f >> 2] | 0;
				if (e) {
					if ((e | 0) != (a | 0)) cg(a);
				} else {
					e = c[v >> 2] | 0;
					c[a >> 2] = 0;
					c[a + 4 >> 2] = 0;
					c[a + 8 >> 2] = e;
					c[f >> 2] = a;
					e = c[c[u >> 2] >> 2] | 0;
					if (e) {
						c[u >> 2] = e;
						a = c[f >> 2] | 0;
					}
					rf(c[r >> 2] | 0, a);
					c[l >> 2] = (c[l >> 2] | 0) + 1;
				}
				a = k + 56 | 0;
				if ((a | 0) == (c[s >> 2] | 0)) break; else {
					k = d;
					m = m + 28 | 0;
					d = a;
				}
			}
			i = x;
			return;
		}
		function af(a, b, d, e, f) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			var g = 0, h = 0, i = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0;
			j = c[f >> 2] | 0;
			n = c[a >> 2] | 0;
			b = (j - n | 0) / 12 | 0;
			if ((e | 0) < 2) return;
			o = (e + -2 | 0) / 2 | 0;
			if ((o | 0) < (b | 0)) return;
			h = b << 1 | 1;
			a = n + (h * 12 | 0) | 0;
			i = h + 1 | 0;
			do if ((i | 0) < (e | 0)) {
				d = n + (i * 12 | 0) | 0;
				b = c[d >> 2] | 0;
				g = c[a >> 2] | 0;
				if ((b | 0) == (g | 0)) {
					if ((c[n + (i * 12 | 0) + 4 >> 2] | 0) >= (c[n + (h * 12 | 0) + 4 >> 2] | 0)) {
						d = a;
						break;
					}
				} else if ((b | 0) >= (g | 0)) {
					d = a;
					break;
				}
				h = i;
			} else d = a; while (0);
			a = c[j >> 2] | 0;
			b = c[d >> 2] | 0;
			if ((a | 0) == (b | 0)) {
				if ((c[j + 4 >> 2] | 0) < (c[d + 4 >> 2] | 0)) return;
			} else if ((a | 0) < (b | 0)) return;
			l = j;
			k = c[l >> 2] | 0;
			l = c[l + 4 >> 2] | 0;
			i = j + 8 | 0;
			m = c[i >> 2] | 0;
			a = d;
			g = c[a + 4 >> 2] | 0;
			c[j >> 2] = c[a >> 2];
			c[j + 4 >> 2] = g;
			c[i >> 2] = c[d + 8 >> 2];
			c[f >> 2] = d;
			a: do if ((o | 0) >= (h | 0)) {
				j = d;
				a = h;
				while (1) {
					b = a << 1 | 1;
					i = n + (b * 12 | 0) | 0;
					a = b + 1 | 0;
					do if ((a | 0) < (e | 0)) {
						d = n + (a * 12 | 0) | 0;
						h = c[d >> 2] | 0;
						g = c[i >> 2] | 0;
						if ((h | 0) == (g | 0)) {
							if ((c[n + (a * 12 | 0) + 4 >> 2] | 0) >= (c[n + (b * 12 | 0) + 4 >> 2] | 0)) {
								d = i;
								a = b;
								break;
							}
						} else if ((h | 0) >= (g | 0)) {
							d = i;
							a = b;
							break;
						}
					} else {
						d = i;
						a = b;
					} while (0);
					g = c[d >> 2] | 0;
					if ((k | 0) == (g | 0)) {
						if ((l | 0) < (c[d + 4 >> 2] | 0)) {
							d = j;
							break a;
						}
					} else if ((k | 0) < (g | 0)) {
						d = j;
						break a;
					}
					g = d;
					h = c[g + 4 >> 2] | 0;
					i = j;
					c[i >> 2] = c[g >> 2];
					c[i + 4 >> 2] = h;
					c[j + 8 >> 2] = c[d + 8 >> 2];
					c[f >> 2] = d;
					if ((o | 0) < (a | 0)) break; else j = d;
				}
			} while (0);
			j = d;
			c[j >> 2] = k;
			c[j + 4 >> 2] = l;
			c[d + 8 >> 2] = m;
			return;
		}
		function bf(b, d) {
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0, l = 0, m = 0, n = 0;
			f = c[d >> 2] | 0;
			do if (f) {
				e = c[d + 4 >> 2] | 0;
				if (!e) {
					h = d;
					g = d;
					i = 7;
					break;
				} else while (1) {
					f = c[e >> 2] | 0;
					if (!f) {
						i = 5;
						break;
					} else e = f;
				}
			} else {
				e = d;
				i = 5;
			} while (0);
			if ((i | 0) == 5) {
				f = c[e + 4 >> 2] | 0;
				if (!f) {
					k = e + 8 | 0;
					l = e;
					f = 0;
					m = 0;
					j = e;
				} else {
					h = e;
					g = e;
					i = 7;
				}
			}
			if ((i | 0) == 7) {
				k = h + 8 | 0;
				c[f + 8 >> 2] = c[k >> 2];
				l = h;
				m = 1;
				j = g;
			}
			h = c[k >> 2] | 0;
			g = c[h >> 2] | 0;
			if ((g | 0) == (l | 0)) {
				c[h >> 2] = f;
				if ((l | 0) == (b | 0)) {
					b = f;
					g = 0;
				} else g = c[h + 4 >> 2] | 0;
			} else c[h + 4 >> 2] = f;
			e = l + 12 | 0;
			i = (a[e >> 0] | 0) != 0;
			if ((l | 0) != (d | 0)) {
				n = d + 8 | 0;
				h = c[n >> 2] | 0;
				c[k >> 2] = h;
				if ((c[c[n >> 2] >> 2] | 0) == (d | 0)) c[h >> 2] = l; else c[h + 4 >> 2] = l;
				h = c[d >> 2] | 0;
				c[j >> 2] = h;
				c[h + 8 >> 2] = l;
				h = c[d + 4 >> 2] | 0;
				c[l + 4 >> 2] = h;
				if (h) c[h + 8 >> 2] = l;
				a[e >> 0] = a[d + 12 >> 0] | 0;
				b = (b | 0) == (d | 0) ? l : b;
			}
			if (!(i & (b | 0) != 0)) return;
			if (m) {
				a[f + 12 >> 0] = 1;
				return;
			} else j = g;
			while (1) {
				i = c[j + 8 >> 2] | 0;
				f = j + 12 | 0;
				e = (a[f >> 0] | 0) != 0;
				if ((c[i >> 2] | 0) == (j | 0)) {
					if (e) g = j; else {
						a[f >> 0] = 1;
						a[i + 12 >> 0] = 0;
						e = c[i >> 2] | 0;
						h = e + 4 | 0;
						f = c[h >> 2] | 0;
						c[i >> 2] = f;
						if (f) c[f + 8 >> 2] = i;
						g = i + 8 | 0;
						c[e + 8 >> 2] = c[g >> 2];
						f = c[g >> 2] | 0;
						if ((c[f >> 2] | 0) == (i | 0)) c[f >> 2] = e; else c[f + 4 >> 2] = e;
						c[h >> 2] = i;
						c[g >> 2] = e;
						g = c[j + 4 >> 2] | 0;
						b = (b | 0) == (g | 0) ? j : b;
						g = c[g >> 2] | 0;
					}
					f = c[g >> 2] | 0;
					e = (f | 0) == 0;
					if (!e ? (a[f + 12 >> 0] | 0) == 0 : 0) {
						b = g;
						i = 68;
						break;
					}
					m = c[g + 4 >> 2] | 0;
					if ((m | 0) != 0 ? (a[m + 12 >> 0] | 0) == 0 : 0) {
						i = 67;
						break;
					}
					a[g + 12 >> 0] = 0;
					f = c[g + 8 >> 2] | 0;
					e = f + 12 | 0;
					if ((f | 0) == (b | 0) | (a[e >> 0] | 0) == 0) {
						i = 64;
						break;
					}
					e = c[f + 8 >> 2] | 0;
					e = (c[e >> 2] | 0) == (f | 0) ? e + 4 | 0 : e;
				} else {
					if (e) h = j; else {
						a[f >> 0] = 1;
						a[i + 12 >> 0] = 0;
						m = i + 4 | 0;
						e = c[m >> 2] | 0;
						f = c[e >> 2] | 0;
						c[m >> 2] = f;
						if (f) c[f + 8 >> 2] = i;
						g = i + 8 | 0;
						c[e + 8 >> 2] = c[g >> 2];
						f = c[g >> 2] | 0;
						if ((c[f >> 2] | 0) == (i | 0)) c[f >> 2] = e; else c[f + 4 >> 2] = e;
						c[e >> 2] = i;
						c[g >> 2] = e;
						h = c[j >> 2] | 0;
						b = (b | 0) == (h | 0) ? j : b;
						h = c[h + 4 >> 2] | 0;
					}
					f = c[h >> 2] | 0;
					if ((f | 0) != 0 ? (a[f + 12 >> 0] | 0) == 0 : 0) {
						e = h;
						i = 38;
						break;
					}
					g = c[h + 4 >> 2] | 0;
					if ((g | 0) != 0 ? (a[g + 12 >> 0] | 0) == 0 : 0) {
						e = h;
						b = g;
						i = 39;
						break;
					}
					a[h + 12 >> 0] = 0;
					e = c[h + 8 >> 2] | 0;
					if ((e | 0) == (b | 0)) {
						e = b;
						i = 36;
						break;
					}
					if (!(a[e + 12 >> 0] | 0)) {
						i = 36;
						break;
					}
					m = c[e + 8 >> 2] | 0;
					e = (c[m >> 2] | 0) == (e | 0) ? m + 4 | 0 : m;
				}
				j = c[e >> 2] | 0;
			}
			if ((i | 0) == 36) {
				a[e + 12 >> 0] = 1;
				return;
			} else if ((i | 0) == 38) {
				b = c[h + 4 >> 2] | 0;
				if (!b) i = 40; else i = 39;
			} else if ((i | 0) == 64) {
				a[e >> 0] = 1;
				return;
			} else if ((i | 0) == 67) if (e) {
				f = g;
				i = 69;
			} else {
				b = g;
				i = 68;
			}
			if ((i | 0) == 39) if (!(a[b + 12 >> 0] | 0)) {
				f = h;
				i = 46;
			} else i = 40; else if ((i | 0) == 68) if (!(a[f + 12 >> 0] | 0)) i = 75; else {
				f = b;
				i = 69;
			}
			if ((i | 0) == 40) {
				a[f + 12 >> 0] = 1;
				a[h + 12 >> 0] = 0;
				g = f + 4 | 0;
				b = c[g >> 2] | 0;
				c[e >> 2] = b;
				if (b) c[b + 8 >> 2] = h;
				b = h + 8 | 0;
				c[f + 8 >> 2] = c[b >> 2];
				e = c[b >> 2] | 0;
				if ((c[e >> 2] | 0) == (h | 0)) c[e >> 2] = f; else c[e + 4 >> 2] = f;
				c[g >> 2] = h;
				c[b >> 2] = f;
				b = h;
				i = 46;
			} else if ((i | 0) == 69) {
				m = f + 4 | 0;
				g = c[m >> 2] | 0;
				a[g + 12 >> 0] = 1;
				a[f + 12 >> 0] = 0;
				e = c[g >> 2] | 0;
				c[m >> 2] = e;
				if (e) c[e + 8 >> 2] = f;
				b = f + 8 | 0;
				c[g + 8 >> 2] = c[b >> 2];
				e = c[b >> 2] | 0;
				if ((c[e >> 2] | 0) == (f | 0)) c[e >> 2] = g; else c[e + 4 >> 2] = g;
				c[g >> 2] = f;
				c[b >> 2] = g;
				b = g;
				i = 75;
			}
			if ((i | 0) == 46) {
				g = c[f + 8 >> 2] | 0;
				m = g + 12 | 0;
				a[f + 12 >> 0] = a[m >> 0] | 0;
				a[m >> 0] = 1;
				a[b + 12 >> 0] = 1;
				m = g + 4 | 0;
				f = c[m >> 2] | 0;
				e = c[f >> 2] | 0;
				c[m >> 2] = e;
				if (e) c[e + 8 >> 2] = g;
				b = g + 8 | 0;
				c[f + 8 >> 2] = c[b >> 2];
				e = c[b >> 2] | 0;
				if ((c[e >> 2] | 0) == (g | 0)) c[e >> 2] = f; else c[e + 4 >> 2] = f;
				c[f >> 2] = g;
				c[b >> 2] = f;
				return;
			} else if ((i | 0) == 75) {
				h = c[b + 8 >> 2] | 0;
				g = h + 12 | 0;
				a[b + 12 >> 0] = a[g >> 0] | 0;
				a[g >> 0] = 1;
				a[f + 12 >> 0] = 1;
				g = c[h >> 2] | 0;
				e = g + 4 | 0;
				f = c[e >> 2] | 0;
				c[h >> 2] = f;
				if (f) c[f + 8 >> 2] = h;
				f = h + 8 | 0;
				c[g + 8 >> 2] = c[f >> 2];
				b = c[f >> 2] | 0;
				if ((c[b >> 2] | 0) == (h | 0)) c[b >> 2] = g; else c[b + 4 >> 2] = g;
				c[e >> 2] = h;
				c[f >> 2] = g;
				return;
			}
		}
		function cf(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0;
			l = c[b + 16 >> 2] | 0;
			j = b + 28 | 0;
			m = c[b + 44 >> 2] | 0;
			n = l >>> 0 > m >>> 0;
			p = n ? b : j;
			u = c[d + 16 >> 2] | 0;
			k = d + 28 | 0;
			s = c[d + 44 >> 2] | 0;
			t = u >>> 0 > s >>> 0;
			q = t ? d : k;
			i = p + 8 | 0;
			h = c[p >> 2] | 0;
			g = c[i >> 2] | 0;
			r = (h | 0) == (g | 0);
			if (r) if ((c[p + 4 >> 2] | 0) < (c[p + 12 >> 2] | 0)) i = p; else e = 4; else if ((h | 0) < (g | 0)) i = p; else e = 4;
			h = q + 8 | 0;
			g = c[q >> 2] | 0;
			f = c[h >> 2] | 0;
			o = (g | 0) == (f | 0);
			if (o) if ((c[q + 4 >> 2] | 0) < (c[q + 12 >> 2] | 0)) f = q; else e = 8; else if ((g | 0) < (f | 0)) f = q; else e = 8;
			if ((e | 0) == 8) f = h;
			h = c[i >> 2] | 0;
			g = c[f >> 2] | 0;
			if ((h | 0) < (g | 0)) {
				m = tf(a + 1 | 0, b, j, f) | 0;
				return m | 0;
			}
			if ((h | 0) > (g | 0)) {
				m = (tf(a + 1 | 0, d, k, i) | 0) ^ 1;
				return m | 0;
			}
			h = c[p + 16 >> 2] | 0;
			g = c[q + 16 >> 2] | 0;
			if ((h | 0) == (g | 0)) {
				do if ((l | 0) != (m | 0)) if (n) {
					f = b + 12 | 0;
					h = 1;
					break;
				} else {
					f = b + 32 | 0;
					h = -1;
					break;
				} else {
					f = b + 4 | 0;
					h = 0;
				} while (0);
				g = c[f >> 2] | 0;
				do if ((u | 0) != (s | 0)) if (t) {
					e = d + 12 | 0;
					f = 1;
					break;
				} else {
					e = d + 32 | 0;
					f = -1;
					break;
				} else {
					e = d + 4 | 0;
					f = 0;
				} while (0);
				e = c[e >> 2] | 0;
				if ((g | 0) < (e | 0)) {
					m = 1;
					return m | 0;
				}
				m = (h | 0) < (f | 0) & (e | 0) >= (g | 0);
				return m | 0;
			}
			i = (l | 0) == (m | 0);
			if (h >>> 0 < g >>> 0) {
				do if (!i) {
					if (!n) {
						g = b + 32 | 0;
						i = -1;
						break;
					}
					if ((c[b >> 2] | 0) == (c[b + 8 >> 2] | 0)) {
						g = b + 4 | 0;
						i = 1;
						break;
					} else {
						g = b + 12 | 0;
						i = 1;
						break;
					}
				} else {
					g = b + 4 | 0;
					i = 0;
				} while (0);
				h = c[g >> 2] | 0;
				do if ((u | 0) != (s | 0)) if (t) {
					e = d + 12 | 0;
					break;
				} else {
					e = d + 32 | 0;
					break;
				} else e = d + 4 | 0; while (0);
				f = c[e >> 2] | 0;
				if ((h | 0) != (f | 0)) {
					m = (h | 0) < (f | 0);
					return m | 0;
				}
				if (r) return ((i | 0) < 0 ? (c[p + 4 >> 2] | 0) == (c[p + 12 >> 2] | 0) : 0) | 0; else {
					m = 0;
					return m | 0;
				}
			}
			do if (!i) if (n) {
				g = b + 12 | 0;
				break;
			} else {
				g = b + 32 | 0;
				break;
			} else g = b + 4 | 0; while (0);
			h = c[g >> 2] | 0;
			do if ((u | 0) != (s | 0)) {
				if (!t) {
					e = d + 32 | 0;
					g = -1;
					break;
				}
				if ((c[d >> 2] | 0) == (c[d + 8 >> 2] | 0)) {
					e = d + 4 | 0;
					g = 1;
					break;
				} else {
					e = d + 12 | 0;
					g = 1;
					break;
				}
			} else {
				e = d + 4 | 0;
				g = 0;
			} while (0);
			f = c[e >> 2] | 0;
			if ((h | 0) != (f | 0)) {
				m = (h | 0) < (f | 0);
				return m | 0;
			}
			if (!o) {
				m = 1;
				return m | 0;
			}
			m = (g | 0) > 0 ? 1 : (c[q + 4 >> 2] | 0) != (c[q + 12 >> 2] | 0);
			return m | 0;
		}
		function df(a, b, d, e, f) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			var g = 0, i = 0, j = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0, v = 0, w = 0;
			n = c[b >> 2] | 0;
			q = b + 8 | 0;
			if ((n | 0) == (c[q >> 2] | 0)) l = (c[b + 4 >> 2] | 0) != (c[b + 12 >> 2] | 0); else l = 1;
			p = c[d >> 2] | 0;
			r = d + 8 | 0;
			m = c[r >> 2] | 0;
			if ((p | 0) == (m | 0)) j = (c[d + 4 >> 2] | 0) != (c[d + 12 >> 2] | 0); else j = 1;
			i = c[e >> 2] | 0;
			w = e + 8 | 0;
			if ((i | 0) == (c[w >> 2] | 0)) o = (c[e + 4 >> 2] | 0) != (c[e + 12 >> 2] | 0); else o = 1;
			do if (l) {
				if (j) {
					m = c[d + 16 >> 2] | 0;
					l = (c[b + 16 >> 2] | 0) == (m | 0);
					if (!o) if (l) {
						b = 0;
						return b | 0;
					} else {
						wf(a + 4 | 0, e, b, d, 3, f);
						break;
					}
					if (l) {
						b = 0;
						return b | 0;
					}
					if ((m | 0) == (c[e + 16 >> 2] | 0)) {
						b = 0;
						return b | 0;
					} else {
						xf(a + 4 | 0, b, d, e, f);
						break;
					}
				}
				if (!o) {
					m = jf(d, e, b) | 0;
					if ((p | 0) < (i | 0)) {
						if ((m | 0) != -1 & (jf(d, e, b + 8 | 0) | 0) != -1) {
							b = 0;
							return b | 0;
						}
					} else if ((m | 0) != -1) {
						b = 0;
						return b | 0;
					}
					vf(a + 4 | 0, d, e, b, 1, f);
					break;
				}
				if ((c[b + 16 >> 2] | 0) == (c[e + 16 >> 2] | 0)) {
					b = 0;
					return b | 0;
				}
				m = (c[e + 24 >> 2] & 32 | 0) == 0;
				if (!(c[b + 24 >> 2] & 32)) if (m) g = 33; else {
					b = 0;
					return b | 0;
				} else if (!m) g = 33;
				if ((g | 0) == 33 ? (jf(b, d, e + 8 | 0) | 0) != -1 : 0) {
					b = 0;
					return b | 0;
				}
				wf(a + 4 | 0, d, b, e, 2, f);
			} else {
				if (j) {
					if (o) if ((c[d + 16 >> 2] | 0) == (c[e + 16 >> 2] | 0)) {
						b = 0;
						return b | 0;
					} else {
						wf(a + 4 | 0, b, d, e, 1, f);
						break;
					}
					if (((p | 0) == (n | 0) ? (m | 0) == (i | 0) ? (c[d + 4 >> 2] | 0) == (c[b + 4 >> 2] | 0) : 0 : 0) ? (c[d + 12 >> 2] | 0) == (c[e + 4 >> 2] | 0) : 0) {
						b = 0;
						return b | 0;
					}
					vf(a + 4 | 0, b, e, d, 2, f);
					break;
				}
				l = jf(b, d, e) | 0;
				if (!o) if ((l | 0) == -1) {
					uf(a + 4 | 0, b, d, e, f);
					break;
				} else {
					b = 0;
					return b | 0;
				}
				m = jf(b, d, e + 8 | 0) | 0;
				if ((p | 0) < (n | 0)) {
					if ((l | 0) != -1 & (m | 0) != -1) {
						b = 0;
						return b | 0;
					}
				} else if ((m | 0) != -1) {
					b = 0;
					return b | 0;
				}
				vf(a + 4 | 0, b, d, e, 3, f);
			} while (0);
			if ((c[b >> 2] | 0) == (c[q >> 2] | 0) ? (s = b + 4 | 0, t = b + 12 | 0, (c[s >> 2] | 0) != (c[t >> 2] | 0)) : 0) {
				m = (c[b + 24 >> 2] & 32 | 0) == 0;
				j = f + 8 | 0;
				l = c[j >> 2] | 0;
				j = c[j + 4 >> 2] | 0;
				h[k >> 3] = +(c[(m ? s : t) >> 2] | 0);
				p = c[k >> 2] | 0;
				o = c[k + 4 >> 2] | 0;
				b = (j | 0) > -1 | (j | 0) == -1 & l >>> 0 > 4294967295;
				q = Xg(0, -2147483648, l | 0, j | 0) | 0;
				l = b ? q : l;
				j = b ? D : j;
				b = (o | 0) > -1 | (o | 0) == -1 & p >>> 0 > 4294967295;
				q = Xg(0, -2147483648, p | 0, o | 0) | 0;
				p = b ? q : p;
				o = b ? D : o;
				b = Xg(l | 0, j | 0, p | 0, o | 0) | 0;
				q = D;
				if ((j >>> 0 > o >>> 0 | (j | 0) == (o | 0) & l >>> 0 > p >>> 0) & (q >>> 0 > 0 | (q | 0) == 0 & b >>> 0 > 64)) {
					b = 0;
					return b | 0;
				}
				h[k >> 3] = +(c[(m ? t : s) >> 2] | 0);
				p = c[k >> 2] | 0;
				o = c[k + 4 >> 2] | 0;
				b = (o | 0) > -1 | (o | 0) == -1 & p >>> 0 > 4294967295;
				q = Xg(0, -2147483648, p | 0, o | 0) | 0;
				p = b ? q : p;
				o = b ? D : o;
				b = Xg(p | 0, o | 0, l | 0, j | 0) | 0;
				q = D;
				if ((o >>> 0 > j >>> 0 | (o | 0) == (j | 0) & p >>> 0 >= l >>> 0) & (q >>> 0 > 0 | (q | 0) == 0 & b >>> 0 > 64)) {
					b = 0;
					return b | 0;
				}
			}
			if ((c[d >> 2] | 0) == (c[r >> 2] | 0) ? (u = d + 4 | 0, v = d + 12 | 0, (c[u >> 2] | 0) != (c[v >> 2] | 0)) : 0) {
				m = (c[d + 24 >> 2] & 32 | 0) == 0;
				j = f + 8 | 0;
				l = c[j >> 2] | 0;
				j = c[j + 4 >> 2] | 0;
				h[k >> 3] = +(c[(m ? u : v) >> 2] | 0);
				p = c[k >> 2] | 0;
				o = c[k + 4 >> 2] | 0;
				b = (j | 0) > -1 | (j | 0) == -1 & l >>> 0 > 4294967295;
				q = Xg(0, -2147483648, l | 0, j | 0) | 0;
				l = b ? q : l;
				j = b ? D : j;
				b = (o | 0) > -1 | (o | 0) == -1 & p >>> 0 > 4294967295;
				q = Xg(0, -2147483648, p | 0, o | 0) | 0;
				p = b ? q : p;
				o = b ? D : o;
				b = Xg(l | 0, j | 0, p | 0, o | 0) | 0;
				q = D;
				if ((j >>> 0 > o >>> 0 | (j | 0) == (o | 0) & l >>> 0 > p >>> 0) & (q >>> 0 > 0 | (q | 0) == 0 & b >>> 0 > 64)) {
					b = 0;
					return b | 0;
				}
				h[k >> 3] = +(c[(m ? v : u) >> 2] | 0);
				p = c[k >> 2] | 0;
				o = c[k + 4 >> 2] | 0;
				b = (o | 0) > -1 | (o | 0) == -1 & p >>> 0 > 4294967295;
				q = Xg(0, -2147483648, p | 0, o | 0) | 0;
				p = b ? q : p;
				o = b ? D : o;
				b = Xg(p | 0, o | 0, l | 0, j | 0) | 0;
				q = D;
				if ((o >>> 0 > j >>> 0 | (o | 0) == (j | 0) & p >>> 0 >= l >>> 0) & (q >>> 0 > 0 | (q | 0) == 0 & b >>> 0 > 64)) {
					b = 0;
					return b | 0;
				}
			}
			if ((c[e >> 2] | 0) != (c[w >> 2] | 0)) {
				b = 1;
				return b | 0;
			}
			g = e + 4 | 0;
			j = e + 12 | 0;
			if ((c[g >> 2] | 0) == (c[j >> 2] | 0)) {
				b = 1;
				return b | 0;
			}
			i = (c[e + 24 >> 2] & 32 | 0) == 0;
			m = f + 8 | 0;
			l = c[m >> 2] | 0;
			m = c[m + 4 >> 2] | 0;
			h[k >> 3] = +(c[(i ? g : j) >> 2] | 0);
			p = c[k >> 2] | 0;
			o = c[k + 4 >> 2] | 0;
			b = (m | 0) > -1 | (m | 0) == -1 & l >>> 0 > 4294967295;
			q = Xg(0, -2147483648, l | 0, m | 0) | 0;
			l = b ? q : l;
			m = b ? D : m;
			b = (o | 0) > -1 | (o | 0) == -1 & p >>> 0 > 4294967295;
			q = Xg(0, -2147483648, p | 0, o | 0) | 0;
			p = b ? q : p;
			o = b ? D : o;
			b = Xg(l | 0, m | 0, p | 0, o | 0) | 0;
			q = D;
			if ((m >>> 0 > o >>> 0 | (m | 0) == (o | 0) & l >>> 0 > p >>> 0) & (q >>> 0 > 0 | (q | 0) == 0 & b >>> 0 > 64)) {
				b = 0;
				return b | 0;
			}
			h[k >> 3] = +(c[(i ? j : g) >> 2] | 0);
			g = c[k >> 2] | 0;
			i = c[k + 4 >> 2] | 0;
			b = (i | 0) > -1 | (i | 0) == -1 & g >>> 0 > 4294967295;
			q = Xg(0, -2147483648, g | 0, i | 0) | 0;
			g = b ? q : g;
			i = b ? D : i;
			if (m >>> 0 > i >>> 0 | (m | 0) == (i | 0) & l >>> 0 > g >>> 0) {
				g = Xg(l | 0, m | 0, g | 0, i | 0) | 0;
				b = D;
				g = (b >>> 0 > 0 | (b | 0) == 0 & g >>> 0 > 64) << 31 >> 31;
			} else {
				g = Xg(g | 0, i | 0, l | 0, m | 0) | 0;
				b = D;
				g = (b >>> 0 > 0 | (b | 0) == 0 & g >>> 0 > 64) & 1;
			}
			b = (g | 0) != 1;
			return b | 0;
		}
		function ef(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0, f = 0, g = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0;
			p = i;
			i = i + 16 | 0;
			j = p;
			e = a + 16 | 0;
			k = bg(48) | 0;
			f = k + 8 | 0;
			d = b + 0 | 0;
			b = f + 40 | 0;
			do {
				c[f >> 2] = c[d >> 2];
				f = f + 4 | 0;
				d = d + 4 | 0;
			} while ((f | 0) < (b | 0));
			c[k >> 2] = e;
			o = a + 20 | 0;
			d = c[o >> 2] | 0;
			c[k + 4 >> 2] = d;
			c[d >> 2] = k;
			c[o >> 2] = k;
			d = a + 24 | 0;
			c[d >> 2] = (c[d >> 2] | 0) + 1;
			c[j >> 2] = k;
			d = a + 4 | 0;
			b = c[d >> 2] | 0;
			if (b >>> 0 < (c[a + 8 >> 2] | 0) >>> 0) {
				if (!b) b = 0; else {
					c[b >> 2] = k;
					b = c[d >> 2] | 0;
				}
				e = b + 4 | 0;
				c[d >> 2] = e;
			} else {
				yf(a, j);
				e = c[d >> 2] | 0;
			}
			m = c[a >> 2] | 0;
			n = e - m | 0;
			j = n >> 2;
			if ((n | 0) <= 4) {
				n = c[o >> 2] | 0;
				n = n + 8 | 0;
				i = p;
				return n | 0;
			}
			d = (j + -2 | 0) / 2 | 0;
			b = m + (d << 2) | 0;
			a = c[b >> 2] | 0;
			k = e + -4 | 0;
			n = c[k >> 2] | 0;
			l = +h[n + 24 >> 3];
			g = +h[a + 24 >> 3];
			do if (l != g) if (l < g) {
				f = n + 16 | 0;
				break;
			} else {
				n = c[o >> 2] | 0;
				n = n + 8 | 0;
				i = p;
				return n | 0;
			} else {
				f = n + 16 | 0;
				if (!(+h[f >> 3] < +h[a + 16 >> 3])) {
					n = c[o >> 2] | 0;
					n = n + 8 | 0;
					i = p;
					return n | 0;
				}
			} while (0);
			c[k >> 2] = a;
			a: do if ((j + -1 | 0) >>> 0 >= 3) {
				e = b;
				while (1) {
					k = d;
					d = (d + -1 | 0) / 2 | 0;
					b = m + (d << 2) | 0;
					j = c[b >> 2] | 0;
					g = +h[j + 24 >> 3];
					if (l != g) {
						if (!(l < g)) {
							b = e;
							break a;
						}
					} else if (!(+h[f >> 3] < +h[j + 16 >> 3])) {
						b = e;
						break a;
					}
					c[m + (k << 2) >> 2] = j;
					if (k >>> 0 < 3) break; else e = b;
				}
			} while (0);
			c[b >> 2] = n;
			n = c[o >> 2] | 0;
			n = n + 8 | 0;
			i = p;
			return n | 0;
		}
		function ff(a, b, d, e, f, g, j) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			g = g | 0;
			j = j | 0;
			var k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0, v = 0, w = 0, x = 0;
			w = i;
			i = i + 80 | 0;
			k = w;
			u = w + 48 | 0;
			v = w + 24 | 0;
			x = +h[f + 8 >> 3];
			h[k >> 3] = +h[f >> 3];
			h[k + 8 >> 3] = x;
			c[k + 16 >> 2] = 0;
			c[k + 20 >> 2] = 0;
			l = b + 16 | 0;
			f = c[l >> 2] | 0;
			if (f >>> 0 < (c[b + 20 >> 2] | 0) >>> 0) {
				if (!f) f = 0; else {
					c[f + 0 >> 2] = c[k + 0 >> 2];
					c[f + 4 >> 2] = c[k + 4 >> 2];
					c[f + 8 >> 2] = c[k + 8 >> 2];
					c[f + 12 >> 2] = c[k + 12 >> 2];
					c[f + 16 >> 2] = c[k + 16 >> 2];
					c[f + 20 >> 2] = c[k + 20 >> 2];
					f = c[l >> 2] | 0;
				}
				f = f + 24 | 0;
				c[l >> 2] = f;
			} else {
				zf(b + 12 | 0, k);
				f = c[l >> 2] | 0;
			}
			t = f + -24 | 0;
			c[g + 4 >> 2] = t;
			c[j + 4 >> 2] = t;
			p = c[d >> 2] | 0;
			f = c[d + 8 >> 2] | 0;
			l = (p | 0) == (f | 0);
			if (l) m = (c[d + 4 >> 2] | 0) != (c[d + 12 >> 2] | 0); else m = 1;
			q = c[e >> 2] | 0;
			r = c[e + 8 >> 2] | 0;
			k = (q | 0) == (r | 0);
			do if (k) {
				o = c[e + 4 >> 2] | 0;
				n = (o | 0) != (c[e + 12 >> 2] | 0);
				if (!(n | m ^ 1)) {
					if ((p | 0) == (q | 0) ? (c[d + 4 >> 2] | 0) == (o | 0) : 0) {
						m = 1;
						break;
					}
					if ((f | 0) == (q | 0) ? (c[d + 12 >> 2] | 0) == (o | 0) : 0) m = 1; else s = 19;
				} else s = 14;
			} else {
				n = 1;
				s = 14;
			} while (0);
			do if ((s | 0) == 14) if (!(m | n ^ 1)) {
				if ((q | 0) == (p | 0) ? (c[e + 4 >> 2] | 0) == (c[d + 4 >> 2] | 0) : 0) {
					m = 1;
					break;
				}
				if ((r | 0) == (p | 0) ? (c[e + 12 >> 2] | 0) == (c[d + 4 >> 2] | 0) : 0) m = 1; else s = 19;
			} else s = 19; while (0);
			if ((s | 0) == 19) {
				if (l) m = (c[d + 4 >> 2] | 0) != (c[d + 12 >> 2] | 0); else m = 1;
				if (k) n = (c[e + 4 >> 2] | 0) != (c[e + 12 >> 2] | 0); else n = 1;
				m = m ^ n ^ 1;
			}
			if (l) o = (c[d + 4 >> 2] | 0) != (c[d + 12 >> 2] | 0); else o = 1;
			do if (k) {
				n = c[e + 4 >> 2] | 0;
				l = (n | 0) != (c[e + 12 >> 2] | 0);
				if (!(l | o ^ 1)) {
					if ((p | 0) == (q | 0) ? (c[d + 4 >> 2] | 0) == (n | 0) : 0) {
						f = 0;
						break;
					}
					if ((f | 0) == (q | 0)) f = (c[d + 12 >> 2] | 0) != (n | 0); else f = 1;
				} else s = 32;
			} else {
				l = 1;
				s = 32;
			} while (0);
			do if ((s | 0) == 32) if (!(o | l ^ 1)) {
				if ((q | 0) == (p | 0) ? (c[e + 4 >> 2] | 0) == (c[d + 4 >> 2] | 0) : 0) {
					f = 0;
					break;
				}
				if ((r | 0) == (p | 0)) f = (c[e + 12 >> 2] | 0) != (c[d + 4 >> 2] | 0); else f = 1;
			} else f = 1; while (0);
			o = b + 24 | 0;
			n = m & 1;
			f = f ? n | 2 : n;
			c[u + 0 >> 2] = 0;
			c[u + 4 >> 2] = 0;
			c[u + 8 >> 2] = 0;
			c[u + 12 >> 2] = 0;
			c[u + 16 >> 2] = 0;
			c[u + 20 >> 2] = f;
			n = b + 28 | 0;
			l = c[n >> 2] | 0;
			m = b + 32 | 0;
			if (l >>> 0 < (c[m >> 2] | 0) >>> 0) {
				if (!l) k = 0; else {
					c[l + 0 >> 2] = c[u + 0 >> 2];
					c[l + 4 >> 2] = c[u + 4 >> 2];
					c[l + 8 >> 2] = c[u + 8 >> 2];
					c[l + 12 >> 2] = c[u + 12 >> 2];
					c[l + 16 >> 2] = c[u + 16 >> 2];
					c[l + 20 >> 2] = c[u + 20 >> 2];
					k = c[n >> 2] | 0;
				}
				k = k + 24 | 0;
				c[n >> 2] = k;
			} else {
				Af(o, u);
				k = c[n >> 2] | 0;
			}
			l = k + -24 | 0;
			c[l >> 2] = (c[b >> 2] | 0) + ((c[d + 16 >> 2] | 0) * 12 | 0);
			c[v + 0 >> 2] = 0;
			c[v + 4 >> 2] = 0;
			c[v + 8 >> 2] = 0;
			c[v + 12 >> 2] = 0;
			c[v + 16 >> 2] = 0;
			c[v + 20 >> 2] = f;
			if (k >>> 0 >= (c[m >> 2] | 0) >>> 0) {
				Af(o, v);
				s = c[n >> 2] | 0;
				r = s + -24 | 0;
				p = e + 16 | 0;
				p = c[p >> 2] | 0;
				q = c[b >> 2] | 0;
				p = q + (p * 12 | 0) | 0;
				c[r >> 2] = p;
				p = k + -16 | 0;
				c[p >> 2] = r;
				p = s + -16 | 0;
				c[p >> 2] = l;
				p = s + -20 | 0;
				c[p >> 2] = t;
				p = g + 16 | 0;
				c[p >> 2] = l;
				p = k + -12 | 0;
				c[p >> 2] = g;
				p = g + 8 | 0;
				p = c[p >> 2] | 0;
				q = p + 12 | 0;
				c[q >> 2] = j;
				q = j + 16 | 0;
				c[q >> 2] = p;
				q = j + 8 | 0;
				q = c[q >> 2] | 0;
				p = q + 12 | 0;
				c[p >> 2] = r;
				s = s + -8 | 0;
				c[s >> 2] = q;
				c[a >> 2] = l;
				s = a + 4 | 0;
				c[s >> 2] = r;
				i = w;
				return;
			}
			if (!k) f = 0; else {
				c[k + 0 >> 2] = c[v + 0 >> 2];
				c[k + 4 >> 2] = c[v + 4 >> 2];
				c[k + 8 >> 2] = c[v + 8 >> 2];
				c[k + 12 >> 2] = c[v + 12 >> 2];
				c[k + 16 >> 2] = c[v + 16 >> 2];
				c[k + 20 >> 2] = c[v + 20 >> 2];
				f = c[n >> 2] | 0;
			}
			s = f + 24 | 0;
			c[n >> 2] = s;
			r = s + -24 | 0;
			p = e + 16 | 0;
			p = c[p >> 2] | 0;
			q = c[b >> 2] | 0;
			p = q + (p * 12 | 0) | 0;
			c[r >> 2] = p;
			p = k + -16 | 0;
			c[p >> 2] = r;
			p = s + -16 | 0;
			c[p >> 2] = l;
			p = s + -20 | 0;
			c[p >> 2] = t;
			p = g + 16 | 0;
			c[p >> 2] = l;
			p = k + -12 | 0;
			c[p >> 2] = g;
			p = g + 8 | 0;
			p = c[p >> 2] | 0;
			q = p + 12 | 0;
			c[q >> 2] = j;
			q = j + 16 | 0;
			c[q >> 2] = p;
			q = j + 8 | 0;
			q = c[q >> 2] | 0;
			p = q + 12 | 0;
			c[p >> 2] = r;
			s = s + -8 | 0;
			c[s >> 2] = q;
			c[a >> 2] = l;
			s = a + 4 | 0;
			c[s >> 2] = r;
			i = w;
			return;
		}
		function gf(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0, f = 0;
			if ((b | 0) != 1) {
				if (b + -1 & b) b = Ug(b) | 0;
			} else b = 2;
			f = c[a + 4 >> 2] | 0;
			if (b >>> 0 > f >>> 0) {
				Bf(a, b);
				return;
			}
			if (b >>> 0 >= f >>> 0) return;
			if (f >>> 0 > 2) e = (f + -1 & f | 0) == 0; else e = 0;
			d = ~~+_(+(+((c[a + 12 >> 2] | 0) >>> 0) / +g[a + 16 >> 2])) >>> 0;
			if (e) d = 1 << 32 - (ba(d + -1 | 0) | 0); else d = Ug(d) | 0;
			b = b >>> 0 < d >>> 0 ? d : b;
			if (b >>> 0 >= f >>> 0) return;
			Bf(a, b);
			return;
		}
		function hf(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0, f = 0;
			if ((b | 0) != 1) {
				if (b + -1 & b) b = Ug(b) | 0;
			} else b = 2;
			f = c[a + 4 >> 2] | 0;
			if (b >>> 0 > f >>> 0) {
				Cf(a, b);
				return;
			}
			if (b >>> 0 >= f >>> 0) return;
			if (f >>> 0 > 2) e = (f + -1 & f | 0) == 0; else e = 0;
			d = ~~+_(+(+((c[a + 12 >> 2] | 0) >>> 0) / +g[a + 16 >> 2])) >>> 0;
			if (e) d = 1 << 32 - (ba(d + -1 | 0) | 0); else d = Ug(d) | 0;
			b = b >>> 0 < d >>> 0 ? d : b;
			if (b >>> 0 >= f >>> 0) return;
			Cf(a, b);
			return;
		}
		function jf(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0;
			o = c[a >> 2] | 0;
			m = c[b >> 2] | 0;
			h = ((m | 0) < 0) << 31 >> 31;
			o = Xg(o | 0, ((o | 0) < 0) << 31 >> 31 | 0, m | 0, h | 0) | 0;
			g = D;
			f = c[d >> 2] | 0;
			f = Xg(m | 0, h | 0, f | 0, ((f | 0) < 0) << 31 >> 31 | 0) | 0;
			h = D;
			m = c[a + 4 >> 2] | 0;
			i = c[b + 4 >> 2] | 0;
			p = ((i | 0) < 0) << 31 >> 31;
			m = Xg(m | 0, ((m | 0) < 0) << 31 >> 31 | 0, i | 0, p | 0) | 0;
			l = D;
			q = c[d + 4 >> 2] | 0;
			q = Xg(i | 0, p | 0, q | 0, ((q | 0) < 0) << 31 >> 31 | 0) | 0;
			p = D;
			i = (g | 0) < 0;
			b = Xg(0, 0, o | 0, g | 0) | 0;
			d = i ? D : g;
			g = (l | 0) < 0;
			n = Xg(0, 0, m | 0, l | 0) | 0;
			l = g ? D : l;
			j = (h | 0) < 0;
			k = Xg(0, 0, f | 0, h | 0) | 0;
			a = j ? D : h;
			h = (p | 0) < 0;
			r = Xg(0, 0, q | 0, p | 0) | 0;
			d = ih((h ? r : q) | 0, (h ? D : p) | 0, (i ? b : o) | 0, d | 0) | 0;
			b = D;
			a = ih((g ? n : m) | 0, l | 0, (j ? k : f) | 0, a | 0) | 0;
			f = D;
			g = j ^ g;
			do if (i ^ h) {
				if (!g) {
					l = $g(d | 0, b | 0, a | 0, f | 0) | 0;
					e = -(+(l >>> 0) + 4294967296 * +(D >>> 0));
					break;
				}
				if (b >>> 0 > f >>> 0 | (b | 0) == (f | 0) & d >>> 0 > a >>> 0) {
					l = Xg(d | 0, b | 0, a | 0, f | 0) | 0;
					e = -(+(l >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					l = Xg(a | 0, f | 0, d | 0, b | 0) | 0;
					e = +(l >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} else {
				if (g) {
					l = $g(d | 0, b | 0, a | 0, f | 0) | 0;
					e = +(l >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
				if (b >>> 0 < f >>> 0 | (b | 0) == (f | 0) & d >>> 0 < a >>> 0) {
					l = Xg(a | 0, f | 0, d | 0, b | 0) | 0;
					e = -(+(l >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					l = Xg(d | 0, b | 0, a | 0, f | 0) | 0;
					e = +(l >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} while (0);
			if (e == 0) {
				l = 0;
				return l | 0;
			}
			l = e < 0 ? -1 : 1;
			return l | 0;
		}
		function kf(a, b, d, e) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			var f = 0, g = 0, h = 0, j = 0, k = 0, l = 0, m = 0, n = 0;
			n = i;
			i = i + 32 | 0;
			m = n;
			h = c[b >> 2] | 0;
			e = c[a >> 2] | 0;
			do if ((h | 0) == (e | 0)) {
				e = (h | 0) == (c[b + 8 >> 2] | 0);
				if (e ? (f = c[b + 4 >> 2] | 0, (f | 0) == (c[b + 12 >> 2] | 0)) : 0) {
					if ((h | 0) != (c[a + 8 >> 2] | 0)) {
						g = 1;
						break;
					}
					e = c[a + 4 >> 2] | 0;
					if ((e | 0) == (c[a + 12 >> 2] | 0)) {
						g = (f | 0) < (e | 0);
						break;
					} else {
						g = (f | 0) <= (e | 0);
						break;
					}
				}
				if ((h | 0) == (c[a + 8 >> 2] | 0)) {
					if (!e) {
						g = 0;
						break;
					}
					g = (c[b + 4 >> 2] | 0) < (c[a + 4 >> 2] | 0);
					break;
				}
				if (!e) {
					e = c[b + 4 >> 2] | 0;
					f = c[a + 4 >> 2] | 0;
					if ((e | 0) == (f | 0)) {
						g = (jf(b + 8 | 0, b, a + 8 | 0) | 0) == 1;
						break;
					} else {
						g = (e | 0) < (f | 0);
						break;
					}
				} else g = 1;
			} else g = (h | 0) < (e | 0); while (0);
			e = c[d >> 2] | 0;
			do if ((e | 0) == (h | 0)) {
				e = (h | 0) == (c[d + 8 >> 2] | 0);
				if (e ? (j = c[d + 4 >> 2] | 0, (j | 0) == (c[d + 12 >> 2] | 0)) : 0) {
					if ((h | 0) != (c[b + 8 >> 2] | 0)) {
						e = 1;
						break;
					}
					e = c[b + 4 >> 2] | 0;
					if ((e | 0) == (c[b + 12 >> 2] | 0)) {
						e = (j | 0) < (e | 0);
						break;
					} else {
						e = (j | 0) <= (e | 0);
						break;
					}
				}
				if ((h | 0) == (c[b + 8 >> 2] | 0)) {
					if (!e) {
						e = 0;
						break;
					}
					e = (c[d + 4 >> 2] | 0) < (c[b + 4 >> 2] | 0);
					break;
				}
				if (!e) {
					e = c[d + 4 >> 2] | 0;
					f = c[b + 4 >> 2] | 0;
					if ((e | 0) == (f | 0)) {
						e = (jf(d + 8 | 0, d, b + 8 | 0) | 0) == 1;
						break;
					} else {
						e = (e | 0) < (f | 0);
						break;
					}
				} else e = 1;
			} else e = (e | 0) < (h | 0); while (0);
			if (!g) {
				if (!e) {
					m = 0;
					i = n;
					return m | 0;
				}
				c[m + 0 >> 2] = c[b + 0 >> 2];
				c[m + 4 >> 2] = c[b + 4 >> 2];
				c[m + 8 >> 2] = c[b + 8 >> 2];
				c[m + 12 >> 2] = c[b + 12 >> 2];
				c[m + 16 >> 2] = c[b + 16 >> 2];
				c[m + 20 >> 2] = c[b + 20 >> 2];
				c[m + 24 >> 2] = c[b + 24 >> 2];
				c[b + 0 >> 2] = c[d + 0 >> 2];
				c[b + 4 >> 2] = c[d + 4 >> 2];
				c[b + 8 >> 2] = c[d + 8 >> 2];
				c[b + 12 >> 2] = c[d + 12 >> 2];
				c[b + 16 >> 2] = c[d + 16 >> 2];
				c[b + 20 >> 2] = c[d + 20 >> 2];
				c[b + 24 >> 2] = c[d + 24 >> 2];
				c[d + 0 >> 2] = c[m + 0 >> 2];
				c[d + 4 >> 2] = c[m + 4 >> 2];
				c[d + 8 >> 2] = c[m + 8 >> 2];
				c[d + 12 >> 2] = c[m + 12 >> 2];
				c[d + 16 >> 2] = c[m + 16 >> 2];
				c[d + 20 >> 2] = c[m + 20 >> 2];
				c[d + 24 >> 2] = c[m + 24 >> 2];
				f = c[b >> 2] | 0;
				e = c[a >> 2] | 0;
				do if ((f | 0) == (e | 0)) {
					e = (f | 0) == (c[b + 8 >> 2] | 0);
					if (e ? (l = c[b + 4 >> 2] | 0, (l | 0) == (c[b + 12 >> 2] | 0)) : 0) {
						if ((f | 0) != (c[a + 8 >> 2] | 0)) break;
						e = c[a + 4 >> 2] | 0;
						if ((e | 0) == (c[a + 12 >> 2] | 0)) {
							if ((l | 0) < (e | 0)) break; else f = 1;
							i = n;
							return f | 0;
						} else {
							if ((l | 0) > (e | 0)) f = 1; else break;
							i = n;
							return f | 0;
						}
					}
					if ((f | 0) == (c[a + 8 >> 2] | 0)) {
						if (!e) {
							m = 1;
							i = n;
							return m | 0;
						}
						if ((c[b + 4 >> 2] | 0) < (c[a + 4 >> 2] | 0)) break; else f = 1;
						i = n;
						return f | 0;
					}
					if (!e) {
						f = c[b + 4 >> 2] | 0;
						e = c[a + 4 >> 2] | 0;
						if ((f | 0) == (e | 0)) {
							if ((jf(b + 8 | 0, b, a + 8 | 0) | 0) == 1) break; else f = 1;
							i = n;
							return f | 0;
						} else {
							if ((f | 0) < (e | 0)) break; else f = 1;
							i = n;
							return f | 0;
						}
					}
				} else if ((f | 0) >= (e | 0)) {
					m = 1;
					i = n;
					return m | 0;
				} while (0);
				c[m + 0 >> 2] = c[a + 0 >> 2];
				c[m + 4 >> 2] = c[a + 4 >> 2];
				c[m + 8 >> 2] = c[a + 8 >> 2];
				c[m + 12 >> 2] = c[a + 12 >> 2];
				c[m + 16 >> 2] = c[a + 16 >> 2];
				c[m + 20 >> 2] = c[a + 20 >> 2];
				c[m + 24 >> 2] = c[a + 24 >> 2];
				c[a + 0 >> 2] = c[b + 0 >> 2];
				c[a + 4 >> 2] = c[b + 4 >> 2];
				c[a + 8 >> 2] = c[b + 8 >> 2];
				c[a + 12 >> 2] = c[b + 12 >> 2];
				c[a + 16 >> 2] = c[b + 16 >> 2];
				c[a + 20 >> 2] = c[b + 20 >> 2];
				c[a + 24 >> 2] = c[b + 24 >> 2];
				c[b + 0 >> 2] = c[m + 0 >> 2];
				c[b + 4 >> 2] = c[m + 4 >> 2];
				c[b + 8 >> 2] = c[m + 8 >> 2];
				c[b + 12 >> 2] = c[m + 12 >> 2];
				c[b + 16 >> 2] = c[m + 16 >> 2];
				c[b + 20 >> 2] = c[m + 20 >> 2];
				c[b + 24 >> 2] = c[m + 24 >> 2];
				m = 2;
				i = n;
				return m | 0;
			}
			if (e) {
				c[m + 0 >> 2] = c[a + 0 >> 2];
				c[m + 4 >> 2] = c[a + 4 >> 2];
				c[m + 8 >> 2] = c[a + 8 >> 2];
				c[m + 12 >> 2] = c[a + 12 >> 2];
				c[m + 16 >> 2] = c[a + 16 >> 2];
				c[m + 20 >> 2] = c[a + 20 >> 2];
				c[m + 24 >> 2] = c[a + 24 >> 2];
				c[a + 0 >> 2] = c[d + 0 >> 2];
				c[a + 4 >> 2] = c[d + 4 >> 2];
				c[a + 8 >> 2] = c[d + 8 >> 2];
				c[a + 12 >> 2] = c[d + 12 >> 2];
				c[a + 16 >> 2] = c[d + 16 >> 2];
				c[a + 20 >> 2] = c[d + 20 >> 2];
				c[a + 24 >> 2] = c[d + 24 >> 2];
				c[d + 0 >> 2] = c[m + 0 >> 2];
				c[d + 4 >> 2] = c[m + 4 >> 2];
				c[d + 8 >> 2] = c[m + 8 >> 2];
				c[d + 12 >> 2] = c[m + 12 >> 2];
				c[d + 16 >> 2] = c[m + 16 >> 2];
				c[d + 20 >> 2] = c[m + 20 >> 2];
				c[d + 24 >> 2] = c[m + 24 >> 2];
				m = 1;
				i = n;
				return m | 0;
			}
			c[m + 0 >> 2] = c[a + 0 >> 2];
			c[m + 4 >> 2] = c[a + 4 >> 2];
			c[m + 8 >> 2] = c[a + 8 >> 2];
			c[m + 12 >> 2] = c[a + 12 >> 2];
			c[m + 16 >> 2] = c[a + 16 >> 2];
			c[m + 20 >> 2] = c[a + 20 >> 2];
			c[m + 24 >> 2] = c[a + 24 >> 2];
			c[a + 0 >> 2] = c[b + 0 >> 2];
			c[a + 4 >> 2] = c[b + 4 >> 2];
			c[a + 8 >> 2] = c[b + 8 >> 2];
			c[a + 12 >> 2] = c[b + 12 >> 2];
			c[a + 16 >> 2] = c[b + 16 >> 2];
			c[a + 20 >> 2] = c[b + 20 >> 2];
			c[a + 24 >> 2] = c[b + 24 >> 2];
			c[b + 0 >> 2] = c[m + 0 >> 2];
			c[b + 4 >> 2] = c[m + 4 >> 2];
			c[b + 8 >> 2] = c[m + 8 >> 2];
			c[b + 12 >> 2] = c[m + 12 >> 2];
			c[b + 16 >> 2] = c[m + 16 >> 2];
			c[b + 20 >> 2] = c[m + 20 >> 2];
			c[b + 24 >> 2] = c[m + 24 >> 2];
			f = c[d >> 2] | 0;
			e = c[b >> 2] | 0;
			do if ((f | 0) == (e | 0)) {
				e = (f | 0) == (c[d + 8 >> 2] | 0);
				if (e ? (k = c[d + 4 >> 2] | 0, (k | 0) == (c[d + 12 >> 2] | 0)) : 0) {
					if ((f | 0) != (c[b + 8 >> 2] | 0)) break;
					e = c[b + 4 >> 2] | 0;
					if ((e | 0) == (c[b + 12 >> 2] | 0)) {
						if ((k | 0) < (e | 0)) break; else f = 1;
						i = n;
						return f | 0;
					} else {
						if ((k | 0) > (e | 0)) f = 1; else break;
						i = n;
						return f | 0;
					}
				}
				if ((f | 0) == (c[b + 8 >> 2] | 0)) {
					if (!e) {
						m = 1;
						i = n;
						return m | 0;
					}
					if ((c[d + 4 >> 2] | 0) < (c[b + 4 >> 2] | 0)) break; else f = 1;
					i = n;
					return f | 0;
				}
				if (!e) {
					e = c[d + 4 >> 2] | 0;
					f = c[b + 4 >> 2] | 0;
					if ((e | 0) == (f | 0)) {
						if ((jf(d + 8 | 0, d, b + 8 | 0) | 0) == 1) break; else f = 1;
						i = n;
						return f | 0;
					} else {
						if ((e | 0) < (f | 0)) break; else f = 1;
						i = n;
						return f | 0;
					}
				}
			} else if ((f | 0) >= (e | 0)) {
				m = 1;
				i = n;
				return m | 0;
			} while (0);
			c[m + 0 >> 2] = c[b + 0 >> 2];
			c[m + 4 >> 2] = c[b + 4 >> 2];
			c[m + 8 >> 2] = c[b + 8 >> 2];
			c[m + 12 >> 2] = c[b + 12 >> 2];
			c[m + 16 >> 2] = c[b + 16 >> 2];
			c[m + 20 >> 2] = c[b + 20 >> 2];
			c[m + 24 >> 2] = c[b + 24 >> 2];
			c[b + 0 >> 2] = c[d + 0 >> 2];
			c[b + 4 >> 2] = c[d + 4 >> 2];
			c[b + 8 >> 2] = c[d + 8 >> 2];
			c[b + 12 >> 2] = c[d + 12 >> 2];
			c[b + 16 >> 2] = c[d + 16 >> 2];
			c[b + 20 >> 2] = c[d + 20 >> 2];
			c[b + 24 >> 2] = c[d + 24 >> 2];
			c[d + 0 >> 2] = c[m + 0 >> 2];
			c[d + 4 >> 2] = c[m + 4 >> 2];
			c[d + 8 >> 2] = c[m + 8 >> 2];
			c[d + 12 >> 2] = c[m + 12 >> 2];
			c[d + 16 >> 2] = c[m + 16 >> 2];
			c[d + 20 >> 2] = c[m + 20 >> 2];
			c[d + 24 >> 2] = c[m + 24 >> 2];
			m = 2;
			i = n;
			return m | 0;
		}
		function lf(a, b, d, e, f) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			var g = 0, h = 0, j = 0, k = 0, l = 0, m = 0, n = 0;
			n = i;
			i = i + 32 | 0;
			m = n;
			l = kf(a, b, d, f) | 0;
			h = c[e >> 2] | 0;
			f = c[d >> 2] | 0;
			do if ((h | 0) == (f | 0)) {
				f = (h | 0) == (c[e + 8 >> 2] | 0);
				if (f ? (g = c[e + 4 >> 2] | 0, (g | 0) == (c[e + 12 >> 2] | 0)) : 0) {
					if ((h | 0) != (c[d + 8 >> 2] | 0)) break;
					f = c[d + 4 >> 2] | 0;
					if ((f | 0) == (c[d + 12 >> 2] | 0)) {
						if ((g | 0) < (f | 0)) break; else g = l;
						i = n;
						return g | 0;
					} else {
						if ((g | 0) > (f | 0)) g = l; else break;
						i = n;
						return g | 0;
					}
				}
				if ((h | 0) == (c[d + 8 >> 2] | 0)) {
					if (!f) {
						a = l;
						i = n;
						return a | 0;
					}
					if ((c[e + 4 >> 2] | 0) < (c[d + 4 >> 2] | 0)) break; else g = l;
					i = n;
					return g | 0;
				}
				if (!f) {
					f = c[e + 4 >> 2] | 0;
					h = c[d + 4 >> 2] | 0;
					if ((f | 0) == (h | 0)) {
						if ((jf(e + 8 | 0, e, d + 8 | 0) | 0) == 1) break; else g = l;
						i = n;
						return g | 0;
					} else {
						if ((f | 0) < (h | 0)) break; else g = l;
						i = n;
						return g | 0;
					}
				}
			} else if ((h | 0) >= (f | 0)) {
				a = l;
				i = n;
				return a | 0;
			} while (0);
			c[m + 0 >> 2] = c[d + 0 >> 2];
			c[m + 4 >> 2] = c[d + 4 >> 2];
			c[m + 8 >> 2] = c[d + 8 >> 2];
			c[m + 12 >> 2] = c[d + 12 >> 2];
			c[m + 16 >> 2] = c[d + 16 >> 2];
			c[m + 20 >> 2] = c[d + 20 >> 2];
			c[m + 24 >> 2] = c[d + 24 >> 2];
			c[d + 0 >> 2] = c[e + 0 >> 2];
			c[d + 4 >> 2] = c[e + 4 >> 2];
			c[d + 8 >> 2] = c[e + 8 >> 2];
			c[d + 12 >> 2] = c[e + 12 >> 2];
			c[d + 16 >> 2] = c[e + 16 >> 2];
			c[d + 20 >> 2] = c[e + 20 >> 2];
			c[d + 24 >> 2] = c[e + 24 >> 2];
			c[e + 0 >> 2] = c[m + 0 >> 2];
			c[e + 4 >> 2] = c[m + 4 >> 2];
			c[e + 8 >> 2] = c[m + 8 >> 2];
			c[e + 12 >> 2] = c[m + 12 >> 2];
			c[e + 16 >> 2] = c[m + 16 >> 2];
			c[e + 20 >> 2] = c[m + 20 >> 2];
			c[e + 24 >> 2] = c[m + 24 >> 2];
			g = l + 1 | 0;
			h = c[d >> 2] | 0;
			f = c[b >> 2] | 0;
			do if ((h | 0) == (f | 0)) {
				f = (h | 0) == (c[d + 8 >> 2] | 0);
				if (f ? (j = c[d + 4 >> 2] | 0, (j | 0) == (c[d + 12 >> 2] | 0)) : 0) {
					if ((h | 0) != (c[b + 8 >> 2] | 0)) break;
					f = c[b + 4 >> 2] | 0;
					if ((f | 0) == (c[b + 12 >> 2] | 0)) {
						if ((j | 0) < (f | 0)) break;
						i = n;
						return g | 0;
					} else {
						if ((j | 0) <= (f | 0)) break;
						i = n;
						return g | 0;
					}
				}
				if ((h | 0) == (c[b + 8 >> 2] | 0)) {
					if (!f) {
						a = g;
						i = n;
						return a | 0;
					}
					if ((c[d + 4 >> 2] | 0) < (c[b + 4 >> 2] | 0)) break;
					i = n;
					return g | 0;
				}
				if (!f) {
					f = c[d + 4 >> 2] | 0;
					h = c[b + 4 >> 2] | 0;
					if ((f | 0) == (h | 0)) {
						if ((jf(d + 8 | 0, d, b + 8 | 0) | 0) == 1) break;
						i = n;
						return g | 0;
					} else {
						if ((f | 0) < (h | 0)) break;
						i = n;
						return g | 0;
					}
				}
			} else if ((h | 0) >= (f | 0)) {
				a = g;
				i = n;
				return a | 0;
			} while (0);
			c[m + 0 >> 2] = c[b + 0 >> 2];
			c[m + 4 >> 2] = c[b + 4 >> 2];
			c[m + 8 >> 2] = c[b + 8 >> 2];
			c[m + 12 >> 2] = c[b + 12 >> 2];
			c[m + 16 >> 2] = c[b + 16 >> 2];
			c[m + 20 >> 2] = c[b + 20 >> 2];
			c[m + 24 >> 2] = c[b + 24 >> 2];
			c[b + 0 >> 2] = c[d + 0 >> 2];
			c[b + 4 >> 2] = c[d + 4 >> 2];
			c[b + 8 >> 2] = c[d + 8 >> 2];
			c[b + 12 >> 2] = c[d + 12 >> 2];
			c[b + 16 >> 2] = c[d + 16 >> 2];
			c[b + 20 >> 2] = c[d + 20 >> 2];
			c[b + 24 >> 2] = c[d + 24 >> 2];
			c[d + 0 >> 2] = c[m + 0 >> 2];
			c[d + 4 >> 2] = c[m + 4 >> 2];
			c[d + 8 >> 2] = c[m + 8 >> 2];
			c[d + 12 >> 2] = c[m + 12 >> 2];
			c[d + 16 >> 2] = c[m + 16 >> 2];
			c[d + 20 >> 2] = c[m + 20 >> 2];
			c[d + 24 >> 2] = c[m + 24 >> 2];
			g = l + 2 | 0;
			h = c[b >> 2] | 0;
			f = c[a >> 2] | 0;
			do if ((h | 0) == (f | 0)) {
				f = (h | 0) == (c[b + 8 >> 2] | 0);
				if (f ? (k = c[b + 4 >> 2] | 0, (k | 0) == (c[b + 12 >> 2] | 0)) : 0) {
					if ((h | 0) != (c[a + 8 >> 2] | 0)) break;
					f = c[a + 4 >> 2] | 0;
					if ((f | 0) == (c[a + 12 >> 2] | 0)) {
						if ((k | 0) < (f | 0)) break;
						i = n;
						return g | 0;
					} else {
						if ((k | 0) <= (f | 0)) break;
						i = n;
						return g | 0;
					}
				}
				if ((h | 0) == (c[a + 8 >> 2] | 0)) {
					if (!f) {
						a = g;
						i = n;
						return a | 0;
					}
					if ((c[b + 4 >> 2] | 0) < (c[a + 4 >> 2] | 0)) break;
					i = n;
					return g | 0;
				}
				if (!f) {
					h = c[b + 4 >> 2] | 0;
					f = c[a + 4 >> 2] | 0;
					if ((h | 0) == (f | 0)) {
						if ((jf(b + 8 | 0, b, a + 8 | 0) | 0) == 1) break;
						i = n;
						return g | 0;
					} else {
						if ((h | 0) < (f | 0)) break;
						i = n;
						return g | 0;
					}
				}
			} else if ((h | 0) >= (f | 0)) {
				a = g;
				i = n;
				return a | 0;
			} while (0);
			c[m + 0 >> 2] = c[a + 0 >> 2];
			c[m + 4 >> 2] = c[a + 4 >> 2];
			c[m + 8 >> 2] = c[a + 8 >> 2];
			c[m + 12 >> 2] = c[a + 12 >> 2];
			c[m + 16 >> 2] = c[a + 16 >> 2];
			c[m + 20 >> 2] = c[a + 20 >> 2];
			c[m + 24 >> 2] = c[a + 24 >> 2];
			c[a + 0 >> 2] = c[b + 0 >> 2];
			c[a + 4 >> 2] = c[b + 4 >> 2];
			c[a + 8 >> 2] = c[b + 8 >> 2];
			c[a + 12 >> 2] = c[b + 12 >> 2];
			c[a + 16 >> 2] = c[b + 16 >> 2];
			c[a + 20 >> 2] = c[b + 20 >> 2];
			c[a + 24 >> 2] = c[b + 24 >> 2];
			c[b + 0 >> 2] = c[m + 0 >> 2];
			c[b + 4 >> 2] = c[m + 4 >> 2];
			c[b + 8 >> 2] = c[m + 8 >> 2];
			c[b + 12 >> 2] = c[m + 12 >> 2];
			c[b + 16 >> 2] = c[m + 16 >> 2];
			c[b + 20 >> 2] = c[m + 20 >> 2];
			c[b + 24 >> 2] = c[m + 24 >> 2];
			a = l + 3 | 0;
			i = n;
			return a | 0;
		}
		function mf(a, b, d, e, f, g) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			g = g | 0;
			var h = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0;
			p = i;
			i = i + 32 | 0;
			o = p;
			n = lf(a, b, d, e, g) | 0;
			j = c[f >> 2] | 0;
			g = c[e >> 2] | 0;
			do if ((j | 0) == (g | 0)) {
				g = (j | 0) == (c[f + 8 >> 2] | 0);
				if (g ? (h = c[f + 4 >> 2] | 0, (h | 0) == (c[f + 12 >> 2] | 0)) : 0) {
					if ((j | 0) != (c[e + 8 >> 2] | 0)) break;
					g = c[e + 4 >> 2] | 0;
					if ((g | 0) == (c[e + 12 >> 2] | 0)) {
						if ((h | 0) < (g | 0)) break; else h = n;
						i = p;
						return h | 0;
					} else {
						if ((h | 0) > (g | 0)) h = n; else break;
						i = p;
						return h | 0;
					}
				}
				if ((j | 0) == (c[e + 8 >> 2] | 0)) {
					if (!g) {
						i = p;
						return n | 0;
					}
					if ((c[f + 4 >> 2] | 0) < (c[e + 4 >> 2] | 0)) break; else h = n;
					i = p;
					return h | 0;
				}
				if (!g) {
					g = c[f + 4 >> 2] | 0;
					j = c[e + 4 >> 2] | 0;
					if ((g | 0) == (j | 0)) {
						if ((jf(f + 8 | 0, f, e + 8 | 0) | 0) == 1) break; else h = n;
						i = p;
						return h | 0;
					} else {
						if ((g | 0) < (j | 0)) break; else h = n;
						i = p;
						return h | 0;
					}
				}
			} else if ((j | 0) >= (g | 0)) {
				i = p;
				return n | 0;
			} while (0);
			c[o + 0 >> 2] = c[e + 0 >> 2];
			c[o + 4 >> 2] = c[e + 4 >> 2];
			c[o + 8 >> 2] = c[e + 8 >> 2];
			c[o + 12 >> 2] = c[e + 12 >> 2];
			c[o + 16 >> 2] = c[e + 16 >> 2];
			c[o + 20 >> 2] = c[e + 20 >> 2];
			c[o + 24 >> 2] = c[e + 24 >> 2];
			c[e + 0 >> 2] = c[f + 0 >> 2];
			c[e + 4 >> 2] = c[f + 4 >> 2];
			c[e + 8 >> 2] = c[f + 8 >> 2];
			c[e + 12 >> 2] = c[f + 12 >> 2];
			c[e + 16 >> 2] = c[f + 16 >> 2];
			c[e + 20 >> 2] = c[f + 20 >> 2];
			c[e + 24 >> 2] = c[f + 24 >> 2];
			c[f + 0 >> 2] = c[o + 0 >> 2];
			c[f + 4 >> 2] = c[o + 4 >> 2];
			c[f + 8 >> 2] = c[o + 8 >> 2];
			c[f + 12 >> 2] = c[o + 12 >> 2];
			c[f + 16 >> 2] = c[o + 16 >> 2];
			c[f + 20 >> 2] = c[o + 20 >> 2];
			c[f + 24 >> 2] = c[o + 24 >> 2];
			h = n + 1 | 0;
			j = c[e >> 2] | 0;
			g = c[d >> 2] | 0;
			do if ((j | 0) == (g | 0)) {
				g = (j | 0) == (c[e + 8 >> 2] | 0);
				if (g ? (k = c[e + 4 >> 2] | 0, (k | 0) == (c[e + 12 >> 2] | 0)) : 0) {
					if ((j | 0) != (c[d + 8 >> 2] | 0)) break;
					g = c[d + 4 >> 2] | 0;
					if ((g | 0) == (c[d + 12 >> 2] | 0)) {
						if ((k | 0) < (g | 0)) break;
						i = p;
						return h | 0;
					} else {
						if ((k | 0) <= (g | 0)) break;
						i = p;
						return h | 0;
					}
				}
				if ((j | 0) == (c[d + 8 >> 2] | 0)) {
					if (!g) {
						n = h;
						i = p;
						return n | 0;
					}
					if ((c[e + 4 >> 2] | 0) < (c[d + 4 >> 2] | 0)) break;
					i = p;
					return h | 0;
				}
				if (!g) {
					g = c[e + 4 >> 2] | 0;
					j = c[d + 4 >> 2] | 0;
					if ((g | 0) == (j | 0)) {
						if ((jf(e + 8 | 0, e, d + 8 | 0) | 0) == 1) break;
						i = p;
						return h | 0;
					} else {
						if ((g | 0) < (j | 0)) break;
						i = p;
						return h | 0;
					}
				}
			} else if ((j | 0) >= (g | 0)) {
				n = h;
				i = p;
				return n | 0;
			} while (0);
			c[o + 0 >> 2] = c[d + 0 >> 2];
			c[o + 4 >> 2] = c[d + 4 >> 2];
			c[o + 8 >> 2] = c[d + 8 >> 2];
			c[o + 12 >> 2] = c[d + 12 >> 2];
			c[o + 16 >> 2] = c[d + 16 >> 2];
			c[o + 20 >> 2] = c[d + 20 >> 2];
			c[o + 24 >> 2] = c[d + 24 >> 2];
			c[d + 0 >> 2] = c[e + 0 >> 2];
			c[d + 4 >> 2] = c[e + 4 >> 2];
			c[d + 8 >> 2] = c[e + 8 >> 2];
			c[d + 12 >> 2] = c[e + 12 >> 2];
			c[d + 16 >> 2] = c[e + 16 >> 2];
			c[d + 20 >> 2] = c[e + 20 >> 2];
			c[d + 24 >> 2] = c[e + 24 >> 2];
			c[e + 0 >> 2] = c[o + 0 >> 2];
			c[e + 4 >> 2] = c[o + 4 >> 2];
			c[e + 8 >> 2] = c[o + 8 >> 2];
			c[e + 12 >> 2] = c[o + 12 >> 2];
			c[e + 16 >> 2] = c[o + 16 >> 2];
			c[e + 20 >> 2] = c[o + 20 >> 2];
			c[e + 24 >> 2] = c[o + 24 >> 2];
			h = n + 2 | 0;
			j = c[d >> 2] | 0;
			g = c[b >> 2] | 0;
			do if ((j | 0) == (g | 0)) {
				g = (j | 0) == (c[d + 8 >> 2] | 0);
				if (g ? (l = c[d + 4 >> 2] | 0, (l | 0) == (c[d + 12 >> 2] | 0)) : 0) {
					if ((j | 0) != (c[b + 8 >> 2] | 0)) break;
					g = c[b + 4 >> 2] | 0;
					if ((g | 0) == (c[b + 12 >> 2] | 0)) {
						if ((l | 0) < (g | 0)) break;
						i = p;
						return h | 0;
					} else {
						if ((l | 0) <= (g | 0)) break;
						i = p;
						return h | 0;
					}
				}
				if ((j | 0) == (c[b + 8 >> 2] | 0)) {
					if (!g) {
						n = h;
						i = p;
						return n | 0;
					}
					if ((c[d + 4 >> 2] | 0) < (c[b + 4 >> 2] | 0)) break;
					i = p;
					return h | 0;
				}
				if (!g) {
					g = c[d + 4 >> 2] | 0;
					j = c[b + 4 >> 2] | 0;
					if ((g | 0) == (j | 0)) {
						if ((jf(d + 8 | 0, d, b + 8 | 0) | 0) == 1) break;
						i = p;
						return h | 0;
					} else {
						if ((g | 0) < (j | 0)) break;
						i = p;
						return h | 0;
					}
				}
			} else if ((j | 0) >= (g | 0)) {
				n = h;
				i = p;
				return n | 0;
			} while (0);
			c[o + 0 >> 2] = c[b + 0 >> 2];
			c[o + 4 >> 2] = c[b + 4 >> 2];
			c[o + 8 >> 2] = c[b + 8 >> 2];
			c[o + 12 >> 2] = c[b + 12 >> 2];
			c[o + 16 >> 2] = c[b + 16 >> 2];
			c[o + 20 >> 2] = c[b + 20 >> 2];
			c[o + 24 >> 2] = c[b + 24 >> 2];
			c[b + 0 >> 2] = c[d + 0 >> 2];
			c[b + 4 >> 2] = c[d + 4 >> 2];
			c[b + 8 >> 2] = c[d + 8 >> 2];
			c[b + 12 >> 2] = c[d + 12 >> 2];
			c[b + 16 >> 2] = c[d + 16 >> 2];
			c[b + 20 >> 2] = c[d + 20 >> 2];
			c[b + 24 >> 2] = c[d + 24 >> 2];
			c[d + 0 >> 2] = c[o + 0 >> 2];
			c[d + 4 >> 2] = c[o + 4 >> 2];
			c[d + 8 >> 2] = c[o + 8 >> 2];
			c[d + 12 >> 2] = c[o + 12 >> 2];
			c[d + 16 >> 2] = c[o + 16 >> 2];
			c[d + 20 >> 2] = c[o + 20 >> 2];
			c[d + 24 >> 2] = c[o + 24 >> 2];
			h = n + 3 | 0;
			j = c[b >> 2] | 0;
			g = c[a >> 2] | 0;
			do if ((j | 0) == (g | 0)) {
				g = (j | 0) == (c[b + 8 >> 2] | 0);
				if (g ? (m = c[b + 4 >> 2] | 0, (m | 0) == (c[b + 12 >> 2] | 0)) : 0) {
					if ((j | 0) != (c[a + 8 >> 2] | 0)) break;
					j = c[a + 4 >> 2] | 0;
					if ((j | 0) == (c[a + 12 >> 2] | 0)) {
						if ((m | 0) < (j | 0)) break;
						i = p;
						return h | 0;
					} else {
						if ((m | 0) <= (j | 0)) break;
						i = p;
						return h | 0;
					}
				}
				if ((j | 0) == (c[a + 8 >> 2] | 0)) {
					if (!g) {
						n = h;
						i = p;
						return n | 0;
					}
					if ((c[b + 4 >> 2] | 0) < (c[a + 4 >> 2] | 0)) break;
					i = p;
					return h | 0;
				}
				if (!g) {
					j = c[b + 4 >> 2] | 0;
					g = c[a + 4 >> 2] | 0;
					if ((j | 0) == (g | 0)) {
						if ((jf(b + 8 | 0, b, a + 8 | 0) | 0) == 1) break;
						i = p;
						return h | 0;
					} else {
						if ((j | 0) < (g | 0)) break;
						i = p;
						return h | 0;
					}
				}
			} else if ((j | 0) >= (g | 0)) {
				n = h;
				i = p;
				return n | 0;
			} while (0);
			c[o + 0 >> 2] = c[a + 0 >> 2];
			c[o + 4 >> 2] = c[a + 4 >> 2];
			c[o + 8 >> 2] = c[a + 8 >> 2];
			c[o + 12 >> 2] = c[a + 12 >> 2];
			c[o + 16 >> 2] = c[a + 16 >> 2];
			c[o + 20 >> 2] = c[a + 20 >> 2];
			c[o + 24 >> 2] = c[a + 24 >> 2];
			c[a + 0 >> 2] = c[b + 0 >> 2];
			c[a + 4 >> 2] = c[b + 4 >> 2];
			c[a + 8 >> 2] = c[b + 8 >> 2];
			c[a + 12 >> 2] = c[b + 12 >> 2];
			c[a + 16 >> 2] = c[b + 16 >> 2];
			c[a + 20 >> 2] = c[b + 20 >> 2];
			c[a + 24 >> 2] = c[b + 24 >> 2];
			c[b + 0 >> 2] = c[o + 0 >> 2];
			c[b + 4 >> 2] = c[o + 4 >> 2];
			c[b + 8 >> 2] = c[o + 8 >> 2];
			c[b + 12 >> 2] = c[o + 12 >> 2];
			c[b + 16 >> 2] = c[o + 16 >> 2];
			c[b + 20 >> 2] = c[o + 20 >> 2];
			c[b + 24 >> 2] = c[o + 24 >> 2];
			n = n + 4 | 0;
			i = p;
			return n | 0;
		}
		function nf(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, h = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0, v = 0, w = 0, x = 0, y = 0, z = 0, A = 0, B = 0, C = 0, E = 0, F = 0, G = 0, H = 0;
			E = i;
			i = i + 16 | 0;
			B = E;
			e = a + 56 | 0;
			kf(a, a + 28 | 0, e, d) | 0;
			d = a + 84 | 0;
			if ((d | 0) == (b | 0)) {
				i = E;
				return;
			}
			z = d;
			while (1) {
				y = c[z >> 2] | 0;
				d = c[e >> 2] | 0;
				do if ((y | 0) == (d | 0)) {
					g = c[z + 8 >> 2] | 0;
					d = (y | 0) == (g | 0);
					if (d ? (A = c[z + 4 >> 2] | 0, (A | 0) == (c[z + 12 >> 2] | 0)) : 0) {
						if ((y | 0) != (c[e + 8 >> 2] | 0)) {
							g = y;
							C = 19;
							break;
						}
						d = c[e + 4 >> 2] | 0;
						if ((d | 0) == (c[e + 12 >> 2] | 0)) if ((A | 0) < (d | 0)) {
							g = y;
							C = 19;
							break;
						} else break; else if ((A | 0) > (d | 0)) break; else {
							g = y;
							C = 19;
							break;
						}
					}
					if ((y | 0) == (c[e + 8 >> 2] | 0)) {
						if (!d) break;
						if ((c[z + 4 >> 2] | 0) < (c[e + 4 >> 2] | 0)) {
							g = y;
							C = 19;
							break;
						} else break;
					}
					if (!d) {
						d = c[z + 4 >> 2] | 0;
						f = c[e + 4 >> 2] | 0;
						if ((d | 0) == (f | 0)) if ((jf(z + 8 | 0, z, e + 8 | 0) | 0) == 1) {
							C = 19;
							break;
						} else break; else if ((d | 0) < (f | 0)) {
							C = 19;
							break;
						} else break;
					} else {
						g = y;
						C = 19;
					}
				} else if ((y | 0) < (d | 0)) {
					g = c[z + 8 >> 2] | 0;
					C = 19;
				} while (0);
				if ((C | 0) == 19) {
					C = 0;
					w = c[z + 4 >> 2] | 0;
					x = c[z + 12 >> 2] | 0;
					v = z + 16 | 0;
					c[B + 0 >> 2] = c[v + 0 >> 2];
					c[B + 4 >> 2] = c[v + 4 >> 2];
					c[B + 8 >> 2] = c[v + 8 >> 2];
					c[z + 0 >> 2] = c[e + 0 >> 2];
					c[z + 4 >> 2] = c[e + 4 >> 2];
					c[z + 8 >> 2] = c[e + 8 >> 2];
					c[z + 12 >> 2] = c[e + 12 >> 2];
					c[z + 16 >> 2] = c[e + 16 >> 2];
					c[z + 20 >> 2] = c[e + 20 >> 2];
					c[z + 24 >> 2] = c[e + 24 >> 2];
					a: do if ((e | 0) == (a | 0)) f = a; else {
						n = (y | 0) == (g | 0);
						o = ((y | 0) < 0) << 31 >> 31;
						r = Xg(g | 0, ((g | 0) < 0) << 31 >> 31 | 0, y | 0, o | 0) | 0;
						s = D;
						p = ((w | 0) < 0) << 31 >> 31;
						u = Xg(x | 0, ((x | 0) < 0) << 31 >> 31 | 0, w | 0, p | 0) | 0;
						v = D;
						q = (s | 0) < 0;
						t = Xg(0, 0, r | 0, s | 0) | 0;
						r = q ? t : r;
						s = q ? D : s;
						t = (v | 0) < 0;
						d = Xg(0, 0, u | 0, v | 0) | 0;
						u = t ? d : u;
						v = t ? D : v;
						if (n & (w | 0) == (x | 0)) while (1) {
							f = e;
							e = e + -28 | 0;
							d = c[e >> 2] | 0;
							do if ((y | 0) == (d | 0)) {
								if ((y | 0) == (c[f + -20 >> 2] | 0)) {
									d = c[f + -24 >> 2] | 0;
									if ((d | 0) == (c[f + -16 >> 2] | 0)) if ((w | 0) < (d | 0)) break; else break a; else if ((w | 0) > (d | 0)) break a; else break;
								}
							} else if ((y | 0) >= (d | 0)) break a; while (0);
							c[f + 0 >> 2] = c[e + 0 >> 2];
							c[f + 4 >> 2] = c[e + 4 >> 2];
							c[f + 8 >> 2] = c[e + 8 >> 2];
							c[f + 12 >> 2] = c[e + 12 >> 2];
							c[f + 16 >> 2] = c[e + 16 >> 2];
							c[f + 20 >> 2] = c[e + 20 >> 2];
							c[f + 24 >> 2] = c[e + 24 >> 2];
							if ((e | 0) == (a | 0)) {
								f = a;
								break a;
							}
						}
						while (1) {
							f = e;
							e = e + -28 | 0;
							d = c[e >> 2] | 0;
							do if ((y | 0) == (d | 0)) {
								j = c[f + -20 >> 2] | 0;
								if ((y | 0) == (j | 0)) {
									if (!n) break a;
									if ((w | 0) < (c[f + -24 >> 2] | 0)) break; else break a;
								}
								if (!n) {
									d = c[f + -24 >> 2] | 0;
									if ((w | 0) != (d | 0)) if ((w | 0) < (d | 0)) break; else break a;
									l = Xg(y | 0, o | 0, j | 0, ((j | 0) < 0) << 31 >> 31 | 0) | 0;
									k = D;
									d = c[f + -16 >> 2] | 0;
									d = Xg(w | 0, p | 0, d | 0, ((d | 0) < 0) << 31 >> 31 | 0) | 0;
									j = D;
									m = (k | 0) < 0;
									G = Xg(0, 0, l | 0, k | 0) | 0;
									k = m ? D : k;
									F = (j | 0) < 0;
									H = Xg(0, 0, d | 0, j | 0) | 0;
									j = ih((F ? H : d) | 0, (F ? D : j) | 0, r | 0, s | 0) | 0;
									d = D;
									k = ih((m ? G : l) | 0, k | 0, u | 0, v | 0) | 0;
									l = D;
									m = t ^ m;
									do if (q ^ F) {
										if (!m) {
											d = $g(j | 0, d | 0, k | 0, l | 0) | 0;
											h = -(+(d >>> 0) + 4294967296 * +(D >>> 0));
											break;
										}
										if (d >>> 0 > l >>> 0 | (d | 0) == (l | 0) & j >>> 0 > k >>> 0) {
											d = Xg(j | 0, d | 0, k | 0, l | 0) | 0;
											h = -(+(d >>> 0) + 4294967296 * +(D >>> 0));
											break;
										} else {
											d = Xg(k | 0, l | 0, j | 0, d | 0) | 0;
											h = +(d >>> 0) + 4294967296 * +(D >>> 0);
											break;
										}
									} else {
										if (m) {
											d = $g(j | 0, d | 0, k | 0, l | 0) | 0;
											h = +(d >>> 0) + 4294967296 * +(D >>> 0);
											break;
										}
										if (d >>> 0 < l >>> 0 | (d | 0) == (l | 0) & j >>> 0 < k >>> 0) {
											d = Xg(k | 0, l | 0, j | 0, d | 0) | 0;
											h = -(+(d >>> 0) + 4294967296 * +(D >>> 0));
											break;
										} else {
											d = Xg(j | 0, d | 0, k | 0, l | 0) | 0;
											h = +(d >>> 0) + 4294967296 * +(D >>> 0);
											break;
										}
									} while (0);
									if (h <= 0) break a;
								}
							} else if ((y | 0) >= (d | 0)) break a; while (0);
							c[f + 0 >> 2] = c[e + 0 >> 2];
							c[f + 4 >> 2] = c[e + 4 >> 2];
							c[f + 8 >> 2] = c[e + 8 >> 2];
							c[f + 12 >> 2] = c[e + 12 >> 2];
							c[f + 16 >> 2] = c[e + 16 >> 2];
							c[f + 20 >> 2] = c[e + 20 >> 2];
							c[f + 24 >> 2] = c[e + 24 >> 2];
							if ((e | 0) == (a | 0)) {
								f = a;
								break;
							}
						}
					} while (0);
					c[f >> 2] = y;
					c[f + 4 >> 2] = w;
					c[f + 8 >> 2] = g;
					c[f + 12 >> 2] = x;
					y = f + 16 | 0;
					c[y + 0 >> 2] = c[B + 0 >> 2];
					c[y + 4 >> 2] = c[B + 4 >> 2];
					c[y + 8 >> 2] = c[B + 8 >> 2];
				}
				d = z + 28 | 0;
				if ((d | 0) == (b | 0)) break; else {
					e = z;
					z = d;
				}
			}
			i = E;
			return;
		}
		function of(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, h = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0, v = 0, w = 0, x = 0, y = 0, z = 0, A = 0, B = 0, C = 0, E = 0, F = 0, G = 0, H = 0, I = 0, J = 0;
			G = i;
			i = i + 48 | 0;
			j = G + 12 | 0;
			E = G;
			switch ((b - a | 0) / 28 | 0 | 0) {
				case 2:
					{
						g = b + -28 | 0;
						e = c[g >> 2] | 0;
						f = c[a >> 2] | 0;
						do if ((e | 0) == (f | 0)) {
							f = (e | 0) == (c[b + -20 >> 2] | 0);
							if (f ? (h = c[b + -24 >> 2] | 0, (h | 0) == (c[b + -16 >> 2] | 0)) : 0) {
								if ((e | 0) != (c[a + 8 >> 2] | 0)) break;
								e = c[a + 4 >> 2] | 0;
								if ((e | 0) == (c[a + 12 >> 2] | 0)) {
									if ((h | 0) < (e | 0)) break; else e = 1;
									i = G;
									return e | 0;
								} else {
									if ((h | 0) > (e | 0)) e = 1; else break;
									i = G;
									return e | 0;
								}
							}
							if ((e | 0) == (c[a + 8 >> 2] | 0)) {
								if (!f) {
									A = 1;
									i = G;
									return A | 0;
								}
								if ((c[b + -24 >> 2] | 0) < (c[a + 4 >> 2] | 0)) break; else e = 1;
								i = G;
								return e | 0;
							}
							if (!f) {
								e = c[b + -24 >> 2] | 0;
								f = c[a + 4 >> 2] | 0;
								if ((e | 0) == (f | 0)) {
									if ((jf(b + -20 | 0, g, a + 8 | 0) | 0) == 1) break; else e = 1;
									i = G;
									return e | 0;
								} else {
									if ((e | 0) < (f | 0)) break; else e = 1;
									i = G;
									return e | 0;
								}
							}
						} else if ((e | 0) >= (f | 0)) {
							A = 1;
							i = G;
							return A | 0;
						} while (0);
						c[j + 0 >> 2] = c[a + 0 >> 2];
						c[j + 4 >> 2] = c[a + 4 >> 2];
						c[j + 8 >> 2] = c[a + 8 >> 2];
						c[j + 12 >> 2] = c[a + 12 >> 2];
						c[j + 16 >> 2] = c[a + 16 >> 2];
						c[j + 20 >> 2] = c[a + 20 >> 2];
						c[j + 24 >> 2] = c[a + 24 >> 2];
						c[a + 0 >> 2] = c[g + 0 >> 2];
						c[a + 4 >> 2] = c[g + 4 >> 2];
						c[a + 8 >> 2] = c[g + 8 >> 2];
						c[a + 12 >> 2] = c[g + 12 >> 2];
						c[a + 16 >> 2] = c[g + 16 >> 2];
						c[a + 20 >> 2] = c[g + 20 >> 2];
						c[a + 24 >> 2] = c[g + 24 >> 2];
						c[g + 0 >> 2] = c[j + 0 >> 2];
						c[g + 4 >> 2] = c[j + 4 >> 2];
						c[g + 8 >> 2] = c[j + 8 >> 2];
						c[g + 12 >> 2] = c[j + 12 >> 2];
						c[g + 16 >> 2] = c[j + 16 >> 2];
						c[g + 20 >> 2] = c[j + 20 >> 2];
						c[g + 24 >> 2] = c[j + 24 >> 2];
						A = 1;
						i = G;
						return A | 0;
					}

				case 5:
					{
						mf(a, a + 28 | 0, a + 56 | 0, a + 84 | 0, b + -28 | 0, d) | 0;
						A = 1;
						i = G;
						return A | 0;
					}

				case 1:
				case 0:
					{
						A = 1;
						i = G;
						return A | 0;
					}

				case 4:
					{
						lf(a, a + 28 | 0, a + 56 | 0, b + -28 | 0, d) | 0;
						A = 1;
						i = G;
						return A | 0;
					}

				case 3:
					{
						kf(a, a + 28 | 0, b + -28 | 0, d) | 0;
						A = 1;
						i = G;
						return A | 0;
					}

				default:
					{
						g = a + 56 | 0;
						kf(a, a + 28 | 0, g, d) | 0;
						e = a + 84 | 0;
						if ((e | 0) == (b | 0)) {
							A = 1;
							i = G;
							return A | 0;
						}
						f = 0;
						while (1) {
							B = c[e >> 2] | 0;
							d = c[g >> 2] | 0;
							do if ((B | 0) == (d | 0)) {
								j = c[e + 8 >> 2] | 0;
								d = (B | 0) == (j | 0);
								if (d ? (C = c[e + 4 >> 2] | 0, (C | 0) == (c[e + 12 >> 2] | 0)) : 0) {
									if ((B | 0) != (c[g + 8 >> 2] | 0)) {
										j = B;
										F = 39;
										break;
									}
									d = c[g + 4 >> 2] | 0;
									if ((d | 0) == (c[g + 12 >> 2] | 0)) if ((C | 0) < (d | 0)) {
										j = B;
										F = 39;
										break;
									} else break; else if ((C | 0) > (d | 0)) break; else {
										j = B;
										F = 39;
										break;
									}
								}
								if ((B | 0) == (c[g + 8 >> 2] | 0)) {
									if (!d) break;
									if ((c[e + 4 >> 2] | 0) < (c[g + 4 >> 2] | 0)) {
										j = B;
										F = 39;
										break;
									} else break;
								}
								if (!d) {
									d = c[e + 4 >> 2] | 0;
									h = c[g + 4 >> 2] | 0;
									if ((d | 0) == (h | 0)) if ((jf(e + 8 | 0, e, g + 8 | 0) | 0) == 1) {
										F = 39;
										break;
									} else break; else if ((d | 0) < (h | 0)) {
										F = 39;
										break;
									} else break;
								} else {
									j = B;
									F = 39;
								}
							} else if ((B | 0) < (d | 0)) {
								j = c[e + 8 >> 2] | 0;
								F = 39;
							} while (0);
							if ((F | 0) == 39) {
								F = 0;
								A = c[e + 4 >> 2] | 0;
								z = c[e + 12 >> 2] | 0;
								y = e + 16 | 0;
								c[E + 0 >> 2] = c[y + 0 >> 2];
								c[E + 4 >> 2] = c[y + 4 >> 2];
								c[E + 8 >> 2] = c[y + 8 >> 2];
								c[e + 0 >> 2] = c[g + 0 >> 2];
								c[e + 4 >> 2] = c[g + 4 >> 2];
								c[e + 8 >> 2] = c[g + 8 >> 2];
								c[e + 12 >> 2] = c[g + 12 >> 2];
								c[e + 16 >> 2] = c[g + 16 >> 2];
								c[e + 20 >> 2] = c[g + 20 >> 2];
								c[e + 24 >> 2] = c[g + 24 >> 2];
								a: do if ((g | 0) == (a | 0)) h = a; else {
									p = (B | 0) == (j | 0);
									y = p & (A | 0) == (z | 0);
									q = ((B | 0) < 0) << 31 >> 31;
									t = Xg(j | 0, ((j | 0) < 0) << 31 >> 31 | 0, B | 0, q | 0) | 0;
									u = D;
									r = ((A | 0) < 0) << 31 >> 31;
									w = Xg(z | 0, ((z | 0) < 0) << 31 >> 31 | 0, A | 0, r | 0) | 0;
									x = D;
									s = (u | 0) < 0;
									v = Xg(0, 0, t | 0, u | 0) | 0;
									t = s ? v : t;
									u = s ? D : u;
									v = (x | 0) < 0;
									d = Xg(0, 0, w | 0, x | 0) | 0;
									w = v ? d : w;
									x = v ? D : x;
									while (1) {
										h = g;
										g = g + -28 | 0;
										d = c[g >> 2] | 0;
										do if ((B | 0) == (d | 0)) {
											l = c[h + -20 >> 2] | 0;
											d = (B | 0) == (l | 0);
											if (y) {
												if (!d) break;
												d = c[h + -24 >> 2] | 0;
												if ((d | 0) == (c[h + -16 >> 2] | 0)) if ((A | 0) < (d | 0)) break; else break a; else if ((A | 0) > (d | 0)) break a; else break;
											}
											if (d) {
												if (!p) break a;
												if ((A | 0) < (c[h + -24 >> 2] | 0)) break; else break a;
											}
											if (!p) {
												d = c[h + -24 >> 2] | 0;
												if ((A | 0) != (d | 0)) if ((A | 0) < (d | 0)) break; else break a;
												n = Xg(B | 0, q | 0, l | 0, ((l | 0) < 0) << 31 >> 31 | 0) | 0;
												m = D;
												d = c[h + -16 >> 2] | 0;
												d = Xg(A | 0, r | 0, d | 0, ((d | 0) < 0) << 31 >> 31 | 0) | 0;
												l = D;
												o = (m | 0) < 0;
												I = Xg(0, 0, n | 0, m | 0) | 0;
												m = o ? D : m;
												H = (l | 0) < 0;
												J = Xg(0, 0, d | 0, l | 0) | 0;
												l = ih((H ? J : d) | 0, (H ? D : l) | 0, t | 0, u | 0) | 0;
												d = D;
												m = ih((o ? I : n) | 0, m | 0, w | 0, x | 0) | 0;
												n = D;
												o = v ^ o;
												do if (s ^ H) {
													if (!o) {
														d = $g(l | 0, d | 0, m | 0, n | 0) | 0;
														k = -(+(d >>> 0) + 4294967296 * +(D >>> 0));
														break;
													}
													if (d >>> 0 > n >>> 0 | (d | 0) == (n | 0) & l >>> 0 > m >>> 0) {
														d = Xg(l | 0, d | 0, m | 0, n | 0) | 0;
														k = -(+(d >>> 0) + 4294967296 * +(D >>> 0));
														break;
													} else {
														d = Xg(m | 0, n | 0, l | 0, d | 0) | 0;
														k = +(d >>> 0) + 4294967296 * +(D >>> 0);
														break;
													}
												} else {
													if (o) {
														d = $g(l | 0, d | 0, m | 0, n | 0) | 0;
														k = +(d >>> 0) + 4294967296 * +(D >>> 0);
														break;
													}
													if (d >>> 0 < n >>> 0 | (d | 0) == (n | 0) & l >>> 0 < m >>> 0) {
														d = Xg(m | 0, n | 0, l | 0, d | 0) | 0;
														k = -(+(d >>> 0) + 4294967296 * +(D >>> 0));
														break;
													} else {
														d = Xg(l | 0, d | 0, m | 0, n | 0) | 0;
														k = +(d >>> 0) + 4294967296 * +(D >>> 0);
														break;
													}
												} while (0);
												if (k <= 0) break a;
											}
										} else if ((B | 0) >= (d | 0)) break a; while (0);
										c[h + 0 >> 2] = c[g + 0 >> 2];
										c[h + 4 >> 2] = c[g + 4 >> 2];
										c[h + 8 >> 2] = c[g + 8 >> 2];
										c[h + 12 >> 2] = c[g + 12 >> 2];
										c[h + 16 >> 2] = c[g + 16 >> 2];
										c[h + 20 >> 2] = c[g + 20 >> 2];
										c[h + 24 >> 2] = c[g + 24 >> 2];
										if ((g | 0) == (a | 0)) {
											h = a;
											break;
										}
									}
								} while (0);
								c[h >> 2] = B;
								c[h + 4 >> 2] = A;
								c[h + 8 >> 2] = j;
								c[h + 12 >> 2] = z;
								A = h + 16 | 0;
								c[A + 0 >> 2] = c[E + 0 >> 2];
								c[A + 4 >> 2] = c[E + 4 >> 2];
								c[A + 8 >> 2] = c[E + 8 >> 2];
								f = f + 1 | 0;
								if ((f | 0) == 8) break;
							}
							d = e + 28 | 0;
							if ((d | 0) == (b | 0)) {
								e = 1;
								F = 70;
								break;
							} else {
								g = e;
								e = d;
							}
						}
						if ((F | 0) == 70) {
							i = G;
							return e | 0;
						}
						A = (e + 28 | 0) == (b | 0);
						i = G;
						return A | 0;
					}
			}
		}
		function pf(a, b, d, e) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			var f = 0, g = 0, h = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0, v = 0, w = 0, x = 0;
			x = i;
			i = i + 80 | 0;
			r = x + 48 | 0;
			s = x + 24 | 0;
			t = x + 12 | 0;
			u = x;
			v = c[d + 16 >> 2] | 0;
			w = c[e + 16 >> 2] | 0;
			p = c[d >> 2] | 0;
			n = c[d + 8 >> 2] | 0;
			j = (p | 0) == (n | 0);
			if (j) k = (c[d + 4 >> 2] | 0) != (c[d + 12 >> 2] | 0); else k = 1;
			m = c[e >> 2] | 0;
			o = c[e + 8 >> 2] | 0;
			f = (m | 0) == (o | 0);
			do if (f) {
				l = c[e + 4 >> 2] | 0;
				h = (l | 0) != (c[e + 12 >> 2] | 0);
				if (!(h | k ^ 1)) {
					if ((p | 0) == (m | 0) ? (c[d + 4 >> 2] | 0) == (l | 0) : 0) {
						k = 1;
						break;
					}
					if ((n | 0) == (m | 0) ? (c[d + 12 >> 2] | 0) == (l | 0) : 0) k = 1; else q = 14;
				} else q = 9;
			} else {
				h = 1;
				q = 9;
			} while (0);
			do if ((q | 0) == 9) if (!(k | h ^ 1)) {
				if ((m | 0) == (p | 0) ? (c[e + 4 >> 2] | 0) == (c[d + 4 >> 2] | 0) : 0) {
					k = 1;
					break;
				}
				if ((o | 0) == (p | 0) ? (c[e + 12 >> 2] | 0) == (c[d + 4 >> 2] | 0) : 0) k = 1; else q = 14;
			} else q = 14; while (0);
			if ((q | 0) == 14) {
				if (j) g = (c[d + 4 >> 2] | 0) != (c[d + 12 >> 2] | 0); else g = 1;
				if (f) h = (c[e + 4 >> 2] | 0) != (c[e + 12 >> 2] | 0); else h = 1;
				k = g ^ h ^ 1;
			}
			if (j) l = (c[d + 4 >> 2] | 0) != (c[d + 12 >> 2] | 0); else l = 1;
			do if (f) {
				g = c[e + 4 >> 2] | 0;
				h = (g | 0) != (c[e + 12 >> 2] | 0);
				if (!(h | l ^ 1)) {
					if ((p | 0) == (m | 0) ? (c[d + 4 >> 2] | 0) == (g | 0) : 0) {
						f = 0;
						break;
					}
					if ((n | 0) == (m | 0)) f = (c[d + 12 >> 2] | 0) != (g | 0); else f = 1;
				} else q = 27;
			} else {
				h = 1;
				q = 27;
			} while (0);
			do if ((q | 0) == 27) if (!(l | h ^ 1)) {
				if ((m | 0) == (p | 0) ? (c[e + 4 >> 2] | 0) == (c[d + 4 >> 2] | 0) : 0) {
					f = 0;
					break;
				}
				if ((o | 0) == (p | 0)) f = (c[e + 12 >> 2] | 0) != (c[d + 4 >> 2] | 0); else f = 1;
			} else f = 1; while (0);
			l = b + 24 | 0;
			h = k & 1;
			h = f ? h | 2 : h;
			c[r + 0 >> 2] = 0;
			c[r + 4 >> 2] = 0;
			c[r + 8 >> 2] = 0;
			c[r + 12 >> 2] = 0;
			c[r + 16 >> 2] = 0;
			c[r + 20 >> 2] = h;
			j = b + 28 | 0;
			g = c[j >> 2] | 0;
			f = b + 32 | 0;
			if (g >>> 0 < (c[f >> 2] | 0) >>> 0) {
				if (!g) g = 0; else {
					c[g + 0 >> 2] = c[r + 0 >> 2];
					c[g + 4 >> 2] = c[r + 4 >> 2];
					c[g + 8 >> 2] = c[r + 8 >> 2];
					c[g + 12 >> 2] = c[r + 12 >> 2];
					c[g + 16 >> 2] = c[r + 16 >> 2];
					c[g + 20 >> 2] = c[r + 20 >> 2];
					g = c[j >> 2] | 0;
				}
				n = g + 24 | 0;
				c[j >> 2] = n;
			} else {
				Af(l, r);
				n = c[j >> 2] | 0;
			}
			m = n + -24 | 0;
			c[s + 0 >> 2] = 0;
			c[s + 4 >> 2] = 0;
			c[s + 8 >> 2] = 0;
			c[s + 12 >> 2] = 0;
			c[s + 16 >> 2] = 0;
			c[s + 20 >> 2] = h;
			if (n >>> 0 < (c[f >> 2] | 0) >>> 0) {
				if (!n) f = 0; else {
					c[n + 0 >> 2] = c[s + 0 >> 2];
					c[n + 4 >> 2] = c[s + 4 >> 2];
					c[n + 8 >> 2] = c[s + 8 >> 2];
					c[n + 12 >> 2] = c[s + 12 >> 2];
					c[n + 16 >> 2] = c[s + 16 >> 2];
					c[n + 20 >> 2] = c[s + 20 >> 2];
					f = c[j >> 2] | 0;
				}
				k = f + 24 | 0;
				c[j >> 2] = k;
			} else {
				Af(l, s);
				k = c[j >> 2] | 0;
			}
			j = k + -24 | 0;
			h = c[b >> 2] | 0;
			l = b + 4 | 0;
			f = c[l >> 2] | 0;
			do if ((h | 0) == (f | 0)) {
				g = c[d + 24 >> 2] & 31;
				c[t >> 2] = c[d + 20 >> 2];
				c[t + 4 >> 2] = 0;
				c[t + 8 >> 2] = g;
				g = b + 8 | 0;
				if (h >>> 0 >= (c[g >> 2] | 0) >>> 0) {
					Ze(b, t);
					f = c[l >> 2] | 0;
					break;
				}
				if (!h) f = 0; else {
					c[h + 0 >> 2] = c[t + 0 >> 2];
					c[h + 4 >> 2] = c[t + 4 >> 2];
					c[h + 8 >> 2] = c[t + 8 >> 2];
					f = c[l >> 2] | 0;
				}
				f = f + 12 | 0;
				c[l >> 2] = f;
			} else g = b + 8 | 0; while (0);
			p = c[e + 24 >> 2] & 31;
			c[u >> 2] = c[e + 20 >> 2];
			c[u + 4 >> 2] = 0;
			c[u + 8 >> 2] = p;
			if (f >>> 0 >= (c[g >> 2] | 0) >>> 0) {
				Ze(b, u);
				p = c[b >> 2] | 0;
				o = p + (v * 12 | 0) | 0;
				c[m >> 2] = o;
				p = p + (w * 12 | 0) | 0;
				c[j >> 2] = p;
				p = n + -16 | 0;
				c[p >> 2] = j;
				p = k + -16 | 0;
				c[p >> 2] = m;
				c[a >> 2] = m;
				p = a + 4 | 0;
				c[p >> 2] = j;
				i = x;
				return;
			}
			if (!f) f = 0; else {
				c[f + 0 >> 2] = c[u + 0 >> 2];
				c[f + 4 >> 2] = c[u + 4 >> 2];
				c[f + 8 >> 2] = c[u + 8 >> 2];
				f = c[l >> 2] | 0;
			}
			c[l >> 2] = f + 12;
			p = c[b >> 2] | 0;
			o = p + (v * 12 | 0) | 0;
			c[m >> 2] = o;
			p = p + (w * 12 | 0) | 0;
			c[j >> 2] = p;
			p = n + -16 | 0;
			c[p >> 2] = j;
			p = k + -16 | 0;
			c[p >> 2] = m;
			c[a >> 2] = m;
			p = a + 4 | 0;
			c[p >> 2] = j;
			i = x;
			return;
		}
		function qf(a, b, d, e) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			var f = 0, g = 0, h = 0, i = 0, j = 0;
			i = a + 4 | 0;
			j = c[b >> 2] | 0;
			if ((j | 0) != (i | 0) ? (h = a + 12 | 0, g = j + 16 | 0, !(cf(h, e, g) | 0)) : 0) {
				if (!(cf(h, g, e) | 0)) {
					c[d >> 2] = j;
					f = d;
					return f | 0;
				}
				b = c[j + 4 >> 2] | 0;
				if (!b) {
					g = j;
					while (1) {
						b = c[g + 8 >> 2] | 0;
						if ((c[b >> 2] | 0) == (g | 0)) break; else g = b;
					}
				} else while (1) {
					g = c[b >> 2] | 0;
					if (!g) break; else b = g;
				}
				if ((b | 0) != (i | 0) ? !(cf(h, e, b + 16 | 0) | 0) : 0) {
					f = c[i >> 2] | 0;
					if (!f) {
						c[d >> 2] = i;
						f = i;
						return f | 0;
					}
					while (1) {
						g = f + 16 | 0;
						if (cf(h, e, g) | 0) {
							g = c[f >> 2] | 0;
							if (!g) {
								g = f;
								a = 35;
								break;
							} else f = g;
						} else {
							if (!(cf(h, g, e) | 0)) {
								a = 40;
								break;
							}
							g = f + 4 | 0;
							b = c[g >> 2] | 0;
							if (!b) {
								a = 39;
								break;
							} else f = b;
						}
					}
					if ((a | 0) == 35) {
						c[d >> 2] = f;
						f = g;
						return f | 0;
					} else if ((a | 0) == 39) {
						c[d >> 2] = f;
						f = g;
						return f | 0;
					} else if ((a | 0) == 40) {
						c[d >> 2] = f;
						f = d;
						return f | 0;
					}
				}
				f = j + 4 | 0;
				if (!(c[f >> 2] | 0)) {
					c[d >> 2] = j;
					return f | 0;
				} else {
					c[d >> 2] = b;
					f = b;
					return f | 0;
				}
			}
			f = c[j >> 2] | 0;
			if ((j | 0) != (c[a >> 2] | 0)) {
				if (!f) {
					b = j;
					while (1) {
						g = c[b + 8 >> 2] | 0;
						if ((c[g >> 2] | 0) == (b | 0)) b = g; else break;
					}
				} else {
					g = f;
					while (1) {
						b = c[g + 4 >> 2] | 0;
						if (!b) break; else g = b;
					}
				}
				a = a + 12 | 0;
				if (!(cf(a, g + 16 | 0, e) | 0)) {
					f = c[i >> 2] | 0;
					if (!f) {
						c[d >> 2] = i;
						f = i;
						return f | 0;
					}
					while (1) {
						g = f + 16 | 0;
						if (cf(a, e, g) | 0) {
							g = c[f >> 2] | 0;
							if (!g) {
								g = f;
								a = 15;
								break;
							} else f = g;
						} else {
							if (!(cf(a, g, e) | 0)) {
								a = 20;
								break;
							}
							g = f + 4 | 0;
							b = c[g >> 2] | 0;
							if (!b) {
								a = 19;
								break;
							} else f = b;
						}
					}
					if ((a | 0) == 15) {
						c[d >> 2] = f;
						f = g;
						return f | 0;
					} else if ((a | 0) == 19) {
						c[d >> 2] = f;
						f = g;
						return f | 0;
					} else if ((a | 0) == 20) {
						c[d >> 2] = f;
						f = d;
						return f | 0;
					}
				}
			} else g = j;
			if (!f) {
				c[d >> 2] = j;
				f = j;
				return f | 0;
			} else {
				c[d >> 2] = g;
				f = g + 4 | 0;
				return f | 0;
			}
		}
		function rf(b, d) {
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0;
			e = (d | 0) == (b | 0);
			a[d + 12 >> 0] = e & 1;
			if (e) return;
			while (1) {
				h = c[d + 8 >> 2] | 0;
				e = h + 12 | 0;
				if (a[e >> 0] | 0) {
					f = 37;
					break;
				}
				k = h + 8 | 0;
				f = d;
				d = c[k >> 2] | 0;
				g = c[d >> 2] | 0;
				if ((g | 0) == (h | 0)) {
					g = c[d + 4 >> 2] | 0;
					if (!g) {
						g = f;
						i = k;
						e = k;
						f = 7;
						break;
					}
					g = g + 12 | 0;
					if (a[g >> 0] | 0) {
						g = f;
						i = k;
						e = k;
						f = 7;
						break;
					}
					a[e >> 0] = 1;
					a[d + 12 >> 0] = (d | 0) == (b | 0) & 1;
					a[g >> 0] = 1;
				} else {
					if (!g) {
						g = f;
						j = k;
						i = h;
						h = k;
						f = 24;
						break;
					}
					g = g + 12 | 0;
					if (a[g >> 0] | 0) {
						g = f;
						j = k;
						i = h;
						h = k;
						f = 24;
						break;
					}
					a[e >> 0] = 1;
					a[d + 12 >> 0] = (d | 0) == (b | 0) & 1;
					a[g >> 0] = 1;
				}
				if ((d | 0) == (b | 0)) {
					f = 37;
					break;
				}
			}
			if ((f | 0) == 7) {
				if ((c[h >> 2] | 0) == (g | 0)) b = h; else {
					g = h + 4 | 0;
					b = c[g >> 2] | 0;
					f = c[b >> 2] | 0;
					c[g >> 2] = f;
					if (f) {
						c[f + 8 >> 2] = h;
						d = c[i >> 2] | 0;
					}
					g = b + 8 | 0;
					c[g >> 2] = d;
					e = c[e >> 2] | 0;
					if ((c[e >> 2] | 0) == (h | 0)) c[e >> 2] = b; else c[e + 4 >> 2] = b;
					c[b >> 2] = h;
					c[i >> 2] = b;
					d = c[g >> 2] | 0;
				}
				a[b + 12 >> 0] = 1;
				a[d + 12 >> 0] = 0;
				f = c[d >> 2] | 0;
				g = f + 4 | 0;
				b = c[g >> 2] | 0;
				c[d >> 2] = b;
				if (b) c[b + 8 >> 2] = d;
				e = d + 8 | 0;
				c[f + 8 >> 2] = c[e >> 2];
				b = c[e >> 2] | 0;
				if ((c[b >> 2] | 0) == (d | 0)) c[b >> 2] = f; else c[b + 4 >> 2] = f;
				c[g >> 2] = d;
				c[e >> 2] = f;
				return;
			} else if ((f | 0) == 24) {
				if ((c[i >> 2] | 0) == (g | 0)) {
					b = c[i >> 2] | 0;
					e = b + 4 | 0;
					g = c[e >> 2] | 0;
					c[i >> 2] = g;
					if (g) {
						c[g + 8 >> 2] = i;
						d = c[j >> 2] | 0;
					}
					f = b + 8 | 0;
					c[f >> 2] = d;
					g = c[h >> 2] | 0;
					if ((c[g >> 2] | 0) == (i | 0)) c[g >> 2] = b; else c[g + 4 >> 2] = b;
					c[e >> 2] = i;
					c[j >> 2] = b;
					d = c[f >> 2] | 0;
				} else b = i;
				a[b + 12 >> 0] = 1;
				a[d + 12 >> 0] = 0;
				e = d + 4 | 0;
				f = c[e >> 2] | 0;
				b = c[f >> 2] | 0;
				c[e >> 2] = b;
				if (b) c[b + 8 >> 2] = d;
				b = d + 8 | 0;
				c[f + 8 >> 2] = c[b >> 2];
				e = c[b >> 2] | 0;
				if ((c[e >> 2] | 0) == (d | 0)) c[e >> 2] = f; else c[e + 4 >> 2] = f;
				c[f >> 2] = d;
				c[b >> 2] = f;
				return;
			} else if ((f | 0) == 37) return;
		}
		function sf(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0, l = 0, m = 0;
			k = a + 4 | 0;
			l = c[a >> 2] | 0;
			e = (((c[k >> 2] | 0) - l | 0) / 12 | 0) + 1 | 0;
			if (e >>> 0 > 357913941) $f(a);
			m = a + 8 | 0;
			f = l;
			d = ((c[m >> 2] | 0) - f | 0) / 12 | 0;
			if (d >>> 0 < 178956970) {
				d = d << 1;
				e = d >>> 0 < e >>> 0 ? e : d;
				d = (c[k >> 2] | 0) - f | 0;
				f = (d | 0) / 12 | 0;
				if (!e) {
					i = 0;
					h = 0;
					g = f;
					e = d;
				} else j = 6;
			} else {
				d = (c[k >> 2] | 0) - f | 0;
				e = 357913941;
				f = (d | 0) / 12 | 0;
				j = 6;
			}
			if ((j | 0) == 6) {
				i = e;
				h = bg(e * 12 | 0) | 0;
				g = f;
				e = d;
			}
			f = h + (g * 12 | 0) | 0;
			if (f) {
				c[f + 0 >> 2] = c[b + 0 >> 2];
				c[f + 4 >> 2] = c[b + 4 >> 2];
				c[f + 8 >> 2] = c[b + 8 >> 2];
			}
			j = h + ((((e | 0) / -12 | 0) + g | 0) * 12 | 0) | 0;
			bh(j | 0, l | 0, e | 0) | 0;
			c[a >> 2] = j;
			c[k >> 2] = h + ((g + 1 | 0) * 12 | 0);
			c[m >> 2] = h + (i * 12 | 0);
			if (!l) return;
			cg(l);
			return;
		}
		function tf(a, b, d, e) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			var f = 0, g = 0, h = 0, i = 0, j = 0, k = 0, l = 0, m = 0;
			h = c[b >> 2] | 0;
			if ((h | 0) == (c[b + 8 >> 2] | 0)) g = (c[b + 4 >> 2] | 0) != (c[b + 12 >> 2] | 0); else g = 1;
			i = c[d >> 2] | 0;
			if ((i | 0) == (c[d + 8 >> 2] | 0)) f = (c[d + 4 >> 2] | 0) != (c[d + 12 >> 2] | 0); else f = 1;
			if (g) if (f) if ((c[b + 16 >> 2] | 0) == (c[d + 16 >> 2] | 0)) {
				f = (jf(b, b + 8 | 0, e) | 0) == 1;
				return f | 0;
			} else {
				j = +Ef(a, b, e);
				f = j < +Ef(a, d, e);
				return f | 0;
			} else {
				g = Df(a, d, b, e, 1) | 0;
				if (!g) {
					j = +(i | 0) - +(c[e >> 2] | 0);
					k = +(c[d + 4 >> 2] | 0) - +(c[e + 4 >> 2] | 0);
					f = !((j * j + k * k) / (j * 2) < +Ef(a, b, e));
					return f | 0;
				} else {
					f = (g | 0) == -1;
					return f | 0;
				}
			}
			if (f) {
				g = Df(a, b, d, e, 0) | 0;
				if (!g) {
					j = +(h | 0) - +(c[e >> 2] | 0);
					k = +(c[b + 4 >> 2] | 0) - +(c[e + 4 >> 2] | 0);
					f = (j * j + k * k) / (j * 2) < +Ef(a, d, e);
					return f | 0;
				} else {
					f = (g | 0) == -1;
					return f | 0;
				}
			}
			do if ((h | 0) > (i | 0)) {
				g = c[e + 4 >> 2] | 0;
				f = c[b + 4 >> 2] | 0;
				if ((g | 0) > (f | 0)) {
					a = g;
					g = c[d + 4 >> 2] | 0;
					break;
				} else {
					f = 0;
					return f | 0;
				}
			} else {
				if ((h | 0) >= (i | 0)) {
					g = c[b + 4 >> 2] | 0;
					b = c[d + 4 >> 2] | 0;
					g = $g(b | 0, ((b | 0) < 0) << 31 >> 31 | 0, g | 0, ((g | 0) < 0) << 31 >> 31 | 0) | 0;
					b = D;
					f = c[e + 4 >> 2] | 0;
					f = Zg(f | 0, ((f | 0) < 0) << 31 >> 31 | 0, 1) | 0;
					a = D;
					f = (b | 0) < (a | 0) | (b | 0) == (a | 0) & g >>> 0 < f >>> 0;
					return f | 0;
				}
				a = c[e + 4 >> 2] | 0;
				g = c[d + 4 >> 2] | 0;
				if ((a | 0) < (g | 0)) {
					f = c[b + 4 >> 2] | 0;
					break;
				} else {
					f = 1;
					return f | 0;
				}
			} while (0);
			j = +(c[e >> 2] | 0);
			l = +(h | 0) - j;
			k = +(a | 0);
			m = +(f | 0) - k;
			j = +(i | 0) - j;
			k = +(g | 0) - k;
			f = (m * m + l * l) / (l * 2) < (k * k + j * j) / (j * 2);
			return f | 0;
		}
		function uf(b, d, e, f, g) {
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			g = g | 0;
			var i = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0, v = 0, w = 0, x = 0, y = 0, z = 0, A = 0, B = 0, C = 0, E = 0, F = 0, G = 0, H = 0, I = 0, J = 0, K = 0, L = 0, M = 0, N = 0, O = 0, Q = 0, R = 0, S = 0, T = 0, U = 0, V = 0, W = 0, X = 0;
			j = c[d >> 2] | 0;
			s = +(j | 0);
			V = c[e >> 2] | 0;
			t = +(V | 0);
			J = s - t;
			o = c[f >> 2] | 0;
			l = +(o | 0);
			K = t - l;
			S = c[d + 4 >> 2] | 0;
			q = +(S | 0);
			N = c[e + 4 >> 2] | 0;
			m = +(N | 0);
			H = q - m;
			W = c[f + 4 >> 2] | 0;
			r = +(W | 0);
			I = m - r;
			n = ((V | 0) < 0) << 31 >> 31;
			j = Xg(j | 0, ((j | 0) < 0) << 31 >> 31 | 0, V | 0, n | 0) | 0;
			k = D;
			o = Xg(V | 0, n | 0, o | 0, ((o | 0) < 0) << 31 >> 31 | 0) | 0;
			n = D;
			V = ((N | 0) < 0) << 31 >> 31;
			S = Xg(S | 0, ((S | 0) < 0) << 31 >> 31 | 0, N | 0, V | 0) | 0;
			R = D;
			W = Xg(N | 0, V | 0, W | 0, ((W | 0) < 0) << 31 >> 31 | 0) | 0;
			V = D;
			N = (k | 0) < 0;
			U = Xg(0, 0, j | 0, k | 0) | 0;
			k = N ? D : k;
			O = (n | 0) < 0;
			Q = Xg(0, 0, o | 0, n | 0) | 0;
			n = O ? D : n;
			p = (R | 0) < 0;
			T = Xg(0, 0, S | 0, R | 0) | 0;
			R = p ? D : R;
			M = (V | 0) < 0;
			X = Xg(0, 0, W | 0, V | 0) | 0;
			k = ih((M ? X : W) | 0, (M ? D : V) | 0, (N ? U : j) | 0, k | 0) | 0;
			j = D;
			n = ih((p ? T : S) | 0, R | 0, (O ? Q : o) | 0, n | 0) | 0;
			o = D;
			p = O ^ p;
			do if (N ^ M) {
				if (!p) {
					p = $g(k | 0, j | 0, n | 0, o | 0) | 0;
					i = -(+(p >>> 0) + 4294967296 * +(D >>> 0));
					break;
				}
				if (j >>> 0 > o >>> 0 | (j | 0) == (o | 0) & k >>> 0 > n >>> 0) {
					p = Xg(k | 0, j | 0, n | 0, o | 0) | 0;
					i = -(+(p >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					p = Xg(n | 0, o | 0, k | 0, j | 0) | 0;
					i = +(p >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} else {
				if (p) {
					p = $g(k | 0, j | 0, n | 0, o | 0) | 0;
					i = +(p >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
				if (j >>> 0 < o >>> 0 | (j | 0) == (o | 0) & k >>> 0 < n >>> 0) {
					p = Xg(n | 0, o | 0, k | 0, j | 0) | 0;
					i = -(+(p >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					p = Xg(k | 0, j | 0, n | 0, o | 0) | 0;
					i = +(p >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} while (0);
			L = .5 / i;
			x = t + l;
			u = q + m;
			y = m + r;
			G = s - l;
			F = q - r;
			A = J * (s + t);
			i = I * A;
			if (i < 0) {
				m = 0 - i;
				if (i > 0) {
					i = (i * 2 + 0) / m;
					if (i < 0) i = -i;
				} else i = 2;
				v = 0;
				w = 0;
				s = m;
				r = i + 1;
			} else {
				v = i + 0;
				w = 3;
				s = 0;
				r = 0;
			}
			E = H * u;
			m = I * E;
			do if (m < 0) {
				l = s - m;
				if (m > 0 | s < 0) {
					m = (m * 2 + s * r) / l;
					if (m < 0) m = -m;
				} else m = r < 2 ? 2 : r;
				r = m + 1;
				q = v;
				s = w;
			} else {
				q = m + v;
				if (v < 0 ? m > 0 | v > 0 : 0) {
					m = (v * w - m * 2) / q;
					if (m < 0) m = -m;
					l = s;
					s = m + 1;
					break;
				}
				l = s;
				s = w < 2 ? 3 : w + 1;
			} while (0);
			x = K * x;
			m = H * x;
			do if (m < 0) {
				i = q - m;
				if (m > 0 | q < 0) {
					m = (m * 2 + q * s) / i;
					if (m < 0) m = -m;
				} else m = s < 2 ? 2 : s;
				v = r;
				q = i;
				s = m + 1;
			} else {
				i = m + l;
				if (l < 0 ? m > 0 | l > 0 : 0) {
					m = (l * r - m * 2) / i;
					if (m < 0) m = -m;
					l = i;
					v = m + 1;
					break;
				}
				l = i;
				v = r < 2 ? 3 : r + 1;
			} while (0);
			w = I * y;
			m = H * w;
			do if (m < 0) {
				r = q - m;
				if (m > 0 | q < 0) {
					m = (m * 2 + q * s) / r;
					if (m < 0) m = -m;
				} else m = s < 2 ? 2 : s;
				C = l;
				B = v;
				q = r;
				z = m + 1;
			} else {
				i = m + l;
				if (l < 0 ? m > 0 | l > 0 : 0) {
					m = (l * v - m * 2) / i;
					if (m < 0) m = -m;
					C = i;
					B = m + 1;
					z = s;
					break;
				}
				C = i;
				B = v < 2 ? 3 : v + 1;
				z = s;
			} while (0);
			m = J * x;
			if (m < 0) {
				l = 0 - m;
				if (m > 0) {
					m = (m * 2 + 0) / l;
					if (m < 0) m = -m;
				} else m = 2;
				v = 0;
				u = 0;
				t = m + 1;
			} else {
				v = m + 0;
				u = 3;
				l = 0;
				t = 0;
			}
			m = J * w;
			do if (m < 0) {
				r = l - m;
				if (m > 0 | l < 0) {
					m = (m * 2 + l * t) / r;
					if (m < 0) m = -m;
				} else m = t < 2 ? 2 : t;
				l = r;
				t = m + 1;
				r = u;
			} else {
				s = m + v;
				if (v < 0 ? m > 0 | v > 0 : 0) {
					m = (v * u - m * 2) / s;
					if (m < 0) m = -m;
					v = s;
					r = m + 1;
					break;
				}
				v = s;
				r = u < 2 ? 3 : u + 1;
			} while (0);
			m = K * A;
			do if (m < 0) {
				s = v - m;
				if (m > 0 | v < 0) {
					m = (m * 2 + v * r) / s;
					if (m < 0) m = -m;
				} else m = r < 2 ? 2 : r;
				i = l;
				r = m + 1;
			} else {
				i = m + l;
				if (l < 0 ? m > 0 | l > 0 : 0) {
					m = (l * t - m * 2) / i;
					if (m < 0) m = -m;
					t = m + 1;
					s = v;
					break;
				}
				t = t < 2 ? 3 : t + 1;
				s = v;
			} while (0);
			m = K * E;
			do if (m < 0) {
				l = s - m;
				if (m > 0 | s < 0) {
					m = (m * 2 + s * r) / l;
					if (m < 0) m = -m;
				} else m = r < 2 ? 2 : r;
				y = i;
				s = l;
				x = m + 1;
			} else {
				l = m + i;
				if (i < 0 ? m > 0 | i > 0 : 0) {
					m = (i * t - m * 2) / l;
					if (m < 0) m = -m;
					y = l;
					t = m + 1;
					x = r;
					break;
				}
				y = l;
				t = t < 2 ? 3 : t + 1;
				x = r;
			} while (0);
			i = +P(+((J * J + H * H) * (K * K + I * I) * (G * G + F * F)));
			do if (i < 0) {
				m = q - i;
				if (q < 0 | i > 0) {
					i = (q * z + i * 5) / m;
					if (i < 0) i = -i;
				} else i = z < 5 ? 5 : z;
				l = C;
				w = B;
				v = i + 1;
			} else {
				l = C + i;
				if (C < 0 ? C > 0 | i > 0 : 0) {
					i = (C * B - i * 5) / l;
					if (i < 0) i = -i;
					m = q;
					w = i + 1;
					v = z;
					break;
				}
				m = q;
				w = B < 5 ? 6 : B + 1;
				v = z;
			} while (0);
			i = q - C;
			r = s - y;
			o = s < 0 | y > 0;
			u = m - l;
			n = l > 0 | m < 0;
			h[g >> 3] = L * i;
			h[g + 8 >> 3] = L * r;
			h[g + 16 >> 3] = L * u;
			a[g + 24 >> 0] = 1;
			if (q < 0 | C > 0 ? q > 0 | C < 0 : 0) {
				i = (q * z + C * B) / i;
				if (i < 0) i = -i;
			} else i = z < B ? B : z;
			p = i + 1 > 64;
			if (o ? s > 0 | y < 0 : 0) {
				i = (s * x + y * t) / r;
				if (i < 0) i = -i;
			} else i = x < t ? t : x;
			k = i + 1 > 64;
			if (n ? l < 0 | m > 0 : 0) {
				i = (w * l + v * m) / u;
				if (i < 0) i = -i;
			} else i = v < w ? w : v;
			j = i + 1 > 64;
			if (!(p | k | j)) return;
			Ff(b, d, e, f, g, p, k, j);
			return;
		}
		function vf(b, d, e, f, g, i) {
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			g = g | 0;
			i = i | 0;
			var j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0, v = 0, w = 0, x = 0, y = 0, z = 0, A = 0, B = 0, C = 0, E = 0, F = 0, G = 0, H = 0, I = 0, J = 0, K = 0, L = 0, M = 0, N = 0, O = 0, Q = 0, R = 0, S = 0, T = 0, U = 0, V = 0, W = 0, X = 0, Y = 0, Z = 0, _ = 0, $ = 0, aa = 0, ba = 0, ca = 0, da = 0, ea = 0, fa = 0, ga = 0, ha = 0, ia = 0, ja = 0, ka = 0, la = 0, ma = 0, na = 0, oa = 0, pa = 0;
			E = c[f + 12 >> 2] | 0;
			B = c[f + 4 >> 2] | 0;
			ia = +(B | 0);
			ka = +(E | 0) - ia;
			W = c[f >> 2] | 0;
			ha = +(W | 0);
			K = c[f + 8 >> 2] | 0;
			la = ha - +(K | 0);
			L = c[e + 4 >> 2] | 0;
			_ = +(L | 0);
			M = c[d + 4 >> 2] | 0;
			fa = +(M | 0);
			da = _ - fa;
			N = c[d >> 2] | 0;
			aa = +(N | 0);
			O = c[e >> 2] | 0;
			$ = +(O | 0);
			ga = aa - $;
			F = ((E | 0) < 0) << 31 >> 31;
			A = ((B | 0) < 0) << 31 >> 31;
			X = Xg(E | 0, F | 0, B | 0, A | 0) | 0;
			Y = D;
			Q = ((W | 0) < 0) << 31 >> 31;
			R = ((K | 0) < 0) << 31 >> 31;
			H = Xg(W | 0, Q | 0, K | 0, R | 0) | 0;
			I = D;
			S = ((O | 0) < 0) << 31 >> 31;
			T = ((N | 0) < 0) << 31 >> 31;
			l = Xg(O | 0, S | 0, N | 0, T | 0) | 0;
			p = D;
			U = ((L | 0) < 0) << 31 >> 31;
			V = ((M | 0) < 0) << 31 >> 31;
			r = Xg(L | 0, U | 0, M | 0, V | 0) | 0;
			s = D;
			Z = (Y | 0) < 0;
			J = Xg(0, 0, X | 0, Y | 0) | 0;
			X = Z ? J : X;
			Y = Z ? D : Y;
			J = (I | 0) < 0;
			j = Xg(0, 0, H | 0, I | 0) | 0;
			H = J ? j : H;
			I = J ? D : I;
			j = (p | 0) < 0;
			na = Xg(0, 0, l | 0, p | 0) | 0;
			p = j ? D : p;
			C = (s | 0) < 0;
			oa = Xg(0, 0, r | 0, s | 0) | 0;
			s = ih((C ? oa : r) | 0, (C ? D : s) | 0, X | 0, Y | 0) | 0;
			r = D;
			p = ih((j ? na : l) | 0, p | 0, H | 0, I | 0) | 0;
			l = D;
			j = J ^ j;
			do if (Z ^ C) {
				if (!j) {
					j = $g(p | 0, l | 0, s | 0, r | 0) | 0;
					w = -(+(j >>> 0) + 4294967296 * +(D >>> 0));
					break;
				}
				if (r >>> 0 > l >>> 0 | (r | 0) == (l | 0) & s >>> 0 > p >>> 0) {
					j = Xg(s | 0, r | 0, p | 0, l | 0) | 0;
					w = -(+(j >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					j = Xg(p | 0, l | 0, s | 0, r | 0) | 0;
					w = +(j >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} else {
				if (j) {
					j = $g(p | 0, l | 0, s | 0, r | 0) | 0;
					w = +(j >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
				if (r >>> 0 < l >>> 0 | (r | 0) == (l | 0) & s >>> 0 < p >>> 0) {
					j = Xg(p | 0, l | 0, s | 0, r | 0) | 0;
					w = -(+(j >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					j = Xg(s | 0, r | 0, p | 0, l | 0) | 0;
					w = +(j >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} while (0);
			l = Xg(B | 0, A | 0, E | 0, F | 0) | 0;
			j = D;
			A = Xg(E | 0, F | 0, M | 0, V | 0) | 0;
			r = D;
			s = Xg(K | 0, R | 0, N | 0, T | 0) | 0;
			B = D;
			C = (j | 0) < 0;
			p = Xg(0, 0, l | 0, j | 0) | 0;
			l = C ? p : l;
			j = C ? D : j;
			p = (r | 0) < 0;
			oa = Xg(0, 0, A | 0, r | 0) | 0;
			r = p ? D : r;
			na = (B | 0) < 0;
			pa = Xg(0, 0, s | 0, B | 0) | 0;
			B = ih((na ? pa : s) | 0, (na ? D : B) | 0, l | 0, j | 0) | 0;
			s = D;
			r = ih((p ? oa : A) | 0, r | 0, H | 0, I | 0) | 0;
			A = D;
			p = J ^ p;
			do if (C ^ na) {
				if (!p) {
					p = $g(B | 0, s | 0, r | 0, A | 0) | 0;
					x = -(+(p >>> 0) + 4294967296 * +(D >>> 0));
					break;
				}
				if (s >>> 0 > A >>> 0 | (s | 0) == (A | 0) & B >>> 0 > r >>> 0) {
					p = Xg(B | 0, s | 0, r | 0, A | 0) | 0;
					x = -(+(p >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					p = Xg(r | 0, A | 0, B | 0, s | 0) | 0;
					x = +(p >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} else {
				if (p) {
					p = $g(B | 0, s | 0, r | 0, A | 0) | 0;
					x = +(p >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
				if (s >>> 0 < A >>> 0 | (s | 0) == (A | 0) & B >>> 0 < r >>> 0) {
					p = Xg(r | 0, A | 0, B | 0, s | 0) | 0;
					x = -(+(p >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					p = Xg(B | 0, s | 0, r | 0, A | 0) | 0;
					x = +(p >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} while (0);
			p = Xg(E | 0, F | 0, L | 0, U | 0) | 0;
			r = D;
			B = Xg(K | 0, R | 0, O | 0, S | 0) | 0;
			E = D;
			s = (r | 0) < 0;
			pa = Xg(0, 0, p | 0, r | 0) | 0;
			r = s ? D : r;
			A = (E | 0) < 0;
			F = Xg(0, 0, B | 0, E | 0) | 0;
			l = ih((A ? F : B) | 0, (A ? D : E) | 0, l | 0, j | 0) | 0;
			j = D;
			r = ih((s ? pa : p) | 0, r | 0, H | 0, I | 0) | 0;
			p = D;
			s = J ^ s;
			do if (C ^ A) {
				if (!s) {
					I = $g(l | 0, j | 0, r | 0, p | 0) | 0;
					G = -(+(I >>> 0) + 4294967296 * +(D >>> 0));
					break;
				}
				if (j >>> 0 > p >>> 0 | (j | 0) == (p | 0) & l >>> 0 > r >>> 0) {
					I = Xg(l | 0, j | 0, r | 0, p | 0) | 0;
					G = -(+(I >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					I = Xg(r | 0, p | 0, l | 0, j | 0) | 0;
					G = +(I >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} else {
				if (s) {
					I = $g(l | 0, j | 0, r | 0, p | 0) | 0;
					G = +(I >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
				if (j >>> 0 < p >>> 0 | (j | 0) == (p | 0) & l >>> 0 < r >>> 0) {
					I = Xg(r | 0, p | 0, l | 0, j | 0) | 0;
					G = -(+(I >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					I = Xg(l | 0, j | 0, r | 0, p | 0) | 0;
					G = +(I >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} while (0);
			s = Xg(M | 0, V | 0, L | 0, U | 0) | 0;
			r = D;
			p = Xg(N | 0, T | 0, O | 0, S | 0) | 0;
			j = D;
			K = Xg(K | 0, R | 0, W | 0, Q | 0) | 0;
			L = D;
			S = (r | 0) < 0;
			M = Xg(0, 0, s | 0, r | 0) | 0;
			r = S ? D : r;
			l = (j | 0) < 0;
			O = Xg(0, 0, p | 0, j | 0) | 0;
			j = l ? D : j;
			T = (L | 0) < 0;
			I = Xg(0, 0, K | 0, L | 0) | 0;
			r = ih((T ? I : K) | 0, (T ? D : L) | 0, (S ? M : s) | 0, r | 0) | 0;
			s = D;
			j = ih(X | 0, Y | 0, (l ? O : p) | 0, j | 0) | 0;
			p = D;
			l = l ^ Z;
			do if (S ^ T) {
				if (!l) {
					T = $g(r | 0, s | 0, j | 0, p | 0) | 0;
					y = -(+(T >>> 0) + 4294967296 * +(D >>> 0));
					break;
				}
				if (s >>> 0 > p >>> 0 | (s | 0) == (p | 0) & r >>> 0 > j >>> 0) {
					T = Xg(r | 0, s | 0, j | 0, p | 0) | 0;
					y = -(+(T >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					T = Xg(j | 0, p | 0, r | 0, s | 0) | 0;
					y = +(T >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} else {
				if (l) {
					T = $g(r | 0, s | 0, j | 0, p | 0) | 0;
					y = +(T >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
				if (s >>> 0 < p >>> 0 | (s | 0) == (p | 0) & r >>> 0 < j >>> 0) {
					T = Xg(j | 0, p | 0, r | 0, s | 0) | 0;
					y = -(+(T >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					T = Xg(r | 0, s | 0, j | 0, p | 0) | 0;
					y = +(T >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} while (0);
			ja = 1 / +P(+(ka * ka + la * la));
			do if (y == 0) {
				m = w / (x * 8);
				if (m < 0) {
					n = 0 - m;
					if (m > 0) {
						k = (m * 4 + 0) / n;
						if (k < 0) k = -k;
					} else k = 4;
					v = k + 1;
					t = 0;
					u = 0;
				} else {
					n = 0;
					v = 0;
					t = m + 0;
					u = 5;
				}
				m = x / (w * 2);
				if (m < 0) {
					o = t - m;
					if (t < 0 | m > 0) {
						k = (t * u + m * 4) / o;
						if (k < 0) k = -k;
					} else k = u < 4 ? 4 : u;
					u = k + 1;
					G = v;
					break;
				}
				q = n + m;
				if (n < 0 ? n > 0 | m > 0 : 0) {
					k = (n * v - m * 4) / q;
					if (k < 0) k = -k;
					o = t;
					n = q;
					G = k + 1;
					break;
				}
				o = t;
				n = q;
				G = v < 4 ? 5 : v + 1;
			} else {
				n = w * w;
				q = y * y;
				o = n + q;
				if (n < 0 | q < 0 ? n > 0 | q > 0 : 0) {
					n = (n * 3 - q * 3) / o;
					if (n < 0) n = -n;
				} else n = 3;
				t = +P(+(G * (x * o))) / q;
				o = (n + 1 + 1 + 1 + 1 + 1) * .5 + 1 + 3 + 1;
				l = t < 0;
				do if ((g | 0) == 2) {
					if (!l) {
						q = 0;
						u = 0;
						n = t + 0;
						z = o > 0 ? o + 1 : 1;
						break;
					}
					q = 0 - t;
					if (t > 0) {
						n = (t * o + 0) / q;
						if (n < 0) n = -n;
					} else n = o > 0 ? o : 0;
					u = n + 1;
					n = 0;
					z = 0;
				} else {
					if (!l) {
						q = t + 0;
						u = o > 0 ? o + 1 : 1;
						n = 0;
						z = 0;
						break;
					}
					n = 0 - t;
					if (t > 0) {
						m = (t * o + 0) / n;
						if (m < 0) m = -m;
					} else m = o > 0 ? o : 0;
					q = 0;
					u = 0;
					z = m + 1;
				} while (0);
				t = x + G;
				if (x < 0 | G < 0 ? x > 0 | G > 0 : 0) {
					o = (x - G) / t;
					if (o < 0) o = -o;
				} else o = 1;
				m = w * t / (y * (y * 2));
				k = o + 1 + 1 + 1 + 4 + 1;
				if (m < 0) {
					t = n - m;
					if (n < 0 | m > 0) {
						k = (n * z + m * k) / t;
						if (k < 0) k = -k;
					} else k = z < k ? k : z;
					o = q;
					n = t;
					G = k + 1;
					break;
				}
				o = q + m;
				if (q < 0 ? q > 0 | m > 0 : 0) {
					k = (q * u - m * k) / o;
					if (k < 0) k = -k;
					u = k + 1;
					G = z;
					break;
				}
				u = (u < k ? k : u) + 1;
				G = z;
			} while (0);
			k = (aa + $) * .5;
			if (k < 0) {
				m = 0 - k;
				if (k > 0) {
					k = (k * 0 + 0) / m;
					if (k < 0) k = -k;
				} else k = 0;
				w = 0;
				x = 0;
				z = m;
				y = k + 1;
			} else {
				w = k + 0;
				x = 1;
				z = 0;
				y = 0;
			}
			if (da < 0) {
				m = -da;
				q = u;
				k = o * m;
				t = G;
				m = n * m;
			} else {
				q = G;
				k = da * n;
				t = u;
				m = da * o;
			}
			v = q + 0 + 1;
			q = t + 0 + 1;
			ea = w + m;
			if (w < 0 | m < 0 ? w > 0 | m > 0 : 0) {
				m = (w * x - m * q) / ea;
				if (m < 0) m = -m;
			} else m = x < q ? q : x;
			ca = m + 1;
			da = z + k;
			if (z < 0 | k < 0 ? z > 0 | k > 0 : 0) {
				m = (z * y - k * v) / da;
				if (m < 0) m = -m;
			} else m = y < v ? v : y;
			ba = m + 1;
			m = (fa + _) * .5;
			if (m < 0) {
				q = 0 - m;
				if (m > 0) {
					m = (m * 0 + 0) / q;
					if (m < 0) m = -m;
				} else m = 0;
				w = 0;
				x = 0;
				z = m + 1;
			} else {
				w = m + 0;
				x = 1;
				q = 0;
				z = 0;
			}
			if (ga < 0) {
				fa = -ga;
				t = u;
				y = o * fa;
				m = G;
				o = n * fa;
			} else {
				t = G;
				y = ga * n;
				m = u;
				o = ga * o;
			}
			t = t + 0 + 1;
			n = m + 0 + 1;
			aa = w + o;
			if (w < 0 | o < 0 ? w > 0 | o > 0 : 0) {
				k = (w * x - o * n) / aa;
				if (k < 0) k = -k;
			} else k = x < n ? n : x;
			_ = k + 1;
			$ = q + y;
			if (q < 0 | y < 0 ? q > 0 | y > 0 : 0) {
				k = (q * z - y * t) / $;
				if (k < 0) k = -k;
			} else k = z < t ? t : z;
			G = k + 1;
			k = ka * ha;
			if (k < 0) {
				n = 0 - k;
				if (k > 0) {
					k = (k + 0) / n;
					if (k < 0) k = -k;
				} else k = 1;
				u = 0;
				w = 0;
				q = k + 1;
			} else {
				u = k + 0;
				w = 2;
				n = 0;
				q = 0;
			}
			m = la * ia;
			do if (m < 0) {
				o = n - m;
				if (n < 0 | m > 0) {
					k = (n * q + m) / o;
					if (k < 0) k = -k;
				} else k = q < 1 ? 1 : q;
				n = o;
				x = k + 1;
				t = u;
			} else {
				t = u + m;
				if (u < 0 ? u > 0 | m > 0 : 0) {
					k = (u * w - m) / t;
					if (k < 0) k = -k;
					x = q;
					w = k + 1;
					break;
				}
				x = q;
				w = w < 1 ? 2 : w + 1;
			} while (0);
			if (ka < 0) {
				q = -ka;
				o = ca;
				u = ea * q;
				m = ba;
				q = da * q;
			} else {
				o = ba;
				u = ka * da;
				m = ca;
				q = ka * ea;
			}
			k = o + 0 + 1;
			o = m + 0 + 1;
			y = n + q;
			if (n < 0 | q < 0 ? n > 0 | q > 0 : 0) {
				m = (n * x - q * o) / y;
				if (m < 0) m = -m;
			} else m = x < o ? o : x;
			x = m + 1;
			z = t + u;
			do if (t < 0 | u < 0 ? t > 0 | u > 0 : 0) {
				k = (t * w - u * k) / z;
				if (!(k < 0)) break;
				k = -k;
			} else ma = 165; while (0);
			if ((ma | 0) == 165) k = w < k ? k : w;
			v = k + 1;
			if (la < 0) {
				m = -la;
				n = _;
				u = aa * m;
				o = G;
				m = $ * m;
			} else {
				n = G;
				u = la * $;
				o = _;
				m = la * aa;
			}
			q = n + 0 + 1;
			n = o + 0 + 1;
			w = y + m;
			do if (y < 0 | m < 0) {
				if (!(y > 0 | m > 0)) {
					ma = 173;
					break;
				}
				k = (y * x - m * n) / w;
				if (!(k < 0)) break;
				k = -k;
			} else ma = 173; while (0);
			if ((ma | 0) == 173) k = x < n ? n : x;
			t = k + 1;
			o = z + u;
			do if (z < 0 | u < 0) {
				if (!(z > 0 | u > 0)) {
					ma = 178;
					break;
				}
				k = (z * v - u * q) / o;
				if (!(k < 0)) break;
				k = -k;
			} else ma = 178; while (0);
			if ((ma | 0) == 178) k = v < q ? q : v;
			k = k + 1;
			if (w < o) {
				q = o;
				o = w;
				m = k;
				k = t;
			} else {
				q = w;
				m = t;
			}
			if (ja < 0) {
				n = k;
				k = m;
				t = -(ja * q);
				m = -(ja * o);
			} else {
				n = m;
				t = ja * o;
				m = ja * q;
			}
			o = k + 3 + 1;
			k = n + 3 + 1;
			v = ea + m;
			p = ea < 0;
			do if (p | m < 0) {
				if (!(ea > 0 | m > 0)) {
					ma = 188;
					break;
				}
				k = (ea * ca - m * k) / v;
				if (!(k < 0)) break;
				k = -k;
			} else ma = 188; while (0);
			if ((ma | 0) == 188) k = ca < k ? k : ca;
			z = k + 1;
			y = da + t;
			r = da < 0;
			do if (r | t < 0) {
				if (!(da > 0 | t > 0)) {
					ma = 193;
					break;
				}
				k = (da * ba - t * o) / y;
				if (!(k < 0)) break;
				k = -k;
			} else ma = 193; while (0);
			if ((ma | 0) == 193) k = ba < o ? o : ba;
			u = k + 1;
			o = ea - da;
			t = aa - $;
			s = aa < 0 | $ > 0;
			q = v - y;
			j = v < 0 | y > 0;
			h[i >> 3] = o;
			h[i + 8 >> 3] = t;
			h[i + 16 >> 3] = q;
			a[i + 24 >> 0] = 1;
			do if ((p | da > 0) & (ea > 0 | r)) {
				k = (ea * ca + da * ba) / o;
				if (!(k < 0)) break;
				k = -k;
			} else k = ca < ba ? ba : ca; while (0);
			p = k + 1 > 64;
			do if (s) {
				if (!(aa > 0 | $ < 0)) {
					ma = 202;
					break;
				}
				k = (aa * _ + $ * G) / t;
				if (!(k < 0)) break;
				k = -k;
			} else ma = 202; while (0);
			if ((ma | 0) == 202) k = _ < G ? G : _;
			l = k + 1 > 64;
			do if (j) {
				if (!(v > 0 | y < 0)) {
					ma = 207;
					break;
				}
				k = (v * z + y * u) / q;
				if (!(k < 0)) break;
				k = -k;
			} else ma = 207; while (0);
			if ((ma | 0) == 207) k = z < u ? u : z;
			j = k + 1 > 64;
			if (!(p | l | j)) return;
			Gf(b, d, e, f, g, i, p, l, j);
			return;
		}
		function wf(b, d, e, f, g, i) {
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			g = g | 0;
			i = i | 0;
			var j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0, v = 0, w = 0, x = 0, y = 0, z = 0, A = 0, B = 0, C = 0, E = 0, F = 0, G = 0, H = 0, I = 0, J = 0, K = 0, L = 0, M = 0, N = 0, O = 0, Q = 0, R = 0, S = 0, T = 0, U = 0, V = 0, W = 0, X = 0, Y = 0, Z = 0, _ = 0, $ = 0, aa = 0, ba = 0, ca = 0, da = 0, ea = 0, fa = 0, ga = 0, ha = 0, ia = 0, ja = 0, ka = 0, la = 0, ma = 0, na = 0, oa = 0, pa = 0, qa = 0, ra = 0, sa = 0, ta = 0, ua = 0, va = 0, wa = 0, xa = 0, ya = 0, za = 0, Aa = 0, Ba = 0;
			j = c[e >> 2] | 0;
			F = c[e + 8 >> 2] | 0;
			H = +(F | 0);
			ca = +(j | 0) - H;
			W = c[e + 4 >> 2] | 0;
			I = c[e + 12 >> 2] | 0;
			S = +(I | 0);
			ba = +(W | 0) - S;
			aa = c[f + 8 >> 2] | 0;
			M = c[f >> 2] | 0;
			K = +(M | 0);
			X = +(aa | 0) - K;
			Y = c[f + 12 >> 2] | 0;
			O = c[f + 4 >> 2] | 0;
			E = +(O | 0);
			R = +(Y | 0) - E;
			T = ((W | 0) < 0) << 31 >> 31;
			J = ((I | 0) < 0) << 31 >> 31;
			ua = Xg(W | 0, T | 0, I | 0, J | 0) | 0;
			va = D;
			U = ((j | 0) < 0) << 31 >> 31;
			G = ((F | 0) < 0) << 31 >> 31;
			wa = Xg(j | 0, U | 0, F | 0, G | 0) | 0;
			xa = D;
			Z = ((Y | 0) < 0) << 31 >> 31;
			Q = ((O | 0) < 0) << 31 >> 31;
			la = Xg(Y | 0, Z | 0, O | 0, Q | 0) | 0;
			ma = D;
			_ = ((aa | 0) < 0) << 31 >> 31;
			N = ((M | 0) < 0) << 31 >> 31;
			ia = Xg(aa | 0, _ | 0, M | 0, N | 0) | 0;
			ja = D;
			ya = (va | 0) < 0;
			za = Xg(0, 0, ua | 0, va | 0) | 0;
			ua = ya ? za : ua;
			va = ya ? D : va;
			za = (xa | 0) < 0;
			oa = Xg(0, 0, wa | 0, xa | 0) | 0;
			wa = za ? oa : wa;
			xa = za ? D : xa;
			oa = (ma | 0) < 0;
			pa = Xg(0, 0, la | 0, ma | 0) | 0;
			la = oa ? pa : la;
			ma = oa ? D : ma;
			pa = (ja | 0) < 0;
			B = Xg(0, 0, ia | 0, ja | 0) | 0;
			ia = pa ? B : ia;
			ja = pa ? D : ja;
			B = ih(ia | 0, ja | 0, ua | 0, va | 0) | 0;
			y = D;
			t = ih(la | 0, ma | 0, wa | 0, xa | 0) | 0;
			x = D;
			m = za ^ oa;
			do if (ya ^ pa) {
				if (!m) {
					u = $g(t | 0, x | 0, B | 0, y | 0) | 0;
					Aa = -(+(u >>> 0) + 4294967296 * +(D >>> 0));
					break;
				}
				if (y >>> 0 > x >>> 0 | (y | 0) == (x | 0) & B >>> 0 > t >>> 0) {
					u = Xg(B | 0, y | 0, t | 0, x | 0) | 0;
					Aa = -(+(u >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					u = Xg(t | 0, x | 0, B | 0, y | 0) | 0;
					Aa = +(u >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} else {
				if (m) {
					u = $g(t | 0, x | 0, B | 0, y | 0) | 0;
					Aa = +(u >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
				if (y >>> 0 < x >>> 0 | (y | 0) == (x | 0) & B >>> 0 < t >>> 0) {
					u = Xg(t | 0, x | 0, B | 0, y | 0) | 0;
					Aa = -(+(u >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					u = Xg(B | 0, y | 0, t | 0, x | 0) | 0;
					Aa = +(u >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} while (0);
			$ = ca * ca + ba * ba;
			if (Aa == 0) {
				u = Xg(O | 0, Q | 0, I | 0, J | 0) | 0;
				l = D;
				m = Xg(M | 0, N | 0, F | 0, G | 0) | 0;
				t = D;
				j = (l | 0) < 0;
				Y = Xg(0, 0, u | 0, l | 0) | 0;
				l = j ? D : l;
				Z = (t | 0) < 0;
				U = Xg(0, 0, m | 0, t | 0) | 0;
				t = ih((Z ? U : m) | 0, (Z ? D : t) | 0, ua | 0, va | 0) | 0;
				m = D;
				l = ih((j ? Y : u) | 0, l | 0, wa | 0, xa | 0) | 0;
				u = D;
				j = za ^ j;
				do if (ya ^ Z) {
					if (!j) {
						Z = $g(t | 0, m | 0, l | 0, u | 0) | 0;
						X = -(+(Z >>> 0) + 4294967296 * +(D >>> 0));
						break;
					}
					if (m >>> 0 > u >>> 0 | (m | 0) == (u | 0) & t >>> 0 > l >>> 0) {
						Z = Xg(t | 0, m | 0, l | 0, u | 0) | 0;
						X = -(+(Z >>> 0) + 4294967296 * +(D >>> 0));
						break;
					} else {
						Z = Xg(l | 0, u | 0, t | 0, m | 0) | 0;
						X = +(Z >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
				} else {
					if (j) {
						Z = $g(t | 0, m | 0, l | 0, u | 0) | 0;
						X = +(Z >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
					if (m >>> 0 < u >>> 0 | (m | 0) == (u | 0) & t >>> 0 < l >>> 0) {
						Z = Xg(l | 0, u | 0, t | 0, m | 0) | 0;
						X = -(+(Z >>> 0) + 4294967296 * +(D >>> 0));
						break;
					} else {
						Z = Xg(t | 0, m | 0, l | 0, u | 0) | 0;
						X = +(Z >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
				} while (0);
				B = c[d >> 2] | 0;
				y = ((B | 0) < 0) << 31 >> 31;
				u = Xg(B | 0, y | 0, F | 0, G | 0) | 0;
				l = D;
				F = c[d + 4 >> 2] | 0;
				x = ((F | 0) < 0) << 31 >> 31;
				m = Xg(F | 0, x | 0, I | 0, J | 0) | 0;
				t = D;
				j = (l | 0) < 0;
				Y = Xg(0, 0, u | 0, l | 0) | 0;
				l = j ? D : l;
				Z = (t | 0) < 0;
				U = Xg(0, 0, m | 0, t | 0) | 0;
				t = ih((Z ? U : m) | 0, (Z ? D : t) | 0, wa | 0, xa | 0) | 0;
				m = D;
				l = ih((j ? Y : u) | 0, l | 0, ua | 0, va | 0) | 0;
				u = D;
				j = ya ^ j;
				do if (za ^ Z) {
					if (!j) {
						Z = $g(t | 0, m | 0, l | 0, u | 0) | 0;
						w = -(+(Z >>> 0) + 4294967296 * +(D >>> 0));
						break;
					}
					if (m >>> 0 > u >>> 0 | (m | 0) == (u | 0) & t >>> 0 > l >>> 0) {
						Z = Xg(t | 0, m | 0, l | 0, u | 0) | 0;
						w = -(+(Z >>> 0) + 4294967296 * +(D >>> 0));
						break;
					} else {
						Z = Xg(l | 0, u | 0, t | 0, m | 0) | 0;
						w = +(Z >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
				} else {
					if (j) {
						Z = $g(t | 0, m | 0, l | 0, u | 0) | 0;
						w = +(Z >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
					if (m >>> 0 < u >>> 0 | (m | 0) == (u | 0) & t >>> 0 < l >>> 0) {
						Z = Xg(l | 0, u | 0, t | 0, m | 0) | 0;
						w = -(+(Z >>> 0) + 4294967296 * +(D >>> 0));
						break;
					} else {
						Z = Xg(t | 0, m | 0, l | 0, u | 0) | 0;
						w = +(Z >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
				} while (0);
				j = Xg(F | 0, x | 0, O | 0, Q | 0) | 0;
				l = D;
				u = Xg(B | 0, y | 0, M | 0, N | 0) | 0;
				t = D;
				m = (l | 0) < 0;
				Y = Xg(0, 0, j | 0, l | 0) | 0;
				l = m ? D : l;
				Z = (t | 0) < 0;
				U = Xg(0, 0, u | 0, t | 0) | 0;
				t = ih((Z ? U : u) | 0, (Z ? D : t) | 0, ua | 0, va | 0) | 0;
				u = D;
				l = ih((m ? Y : j) | 0, l | 0, wa | 0, xa | 0) | 0;
				j = D;
				m = za ^ m;
				do if (ya ^ Z) {
					if (!m) {
						Z = $g(t | 0, u | 0, l | 0, j | 0) | 0;
						p = -(+(Z >>> 0) + 4294967296 * +(D >>> 0));
						break;
					}
					if (u >>> 0 > j >>> 0 | (u | 0) == (j | 0) & t >>> 0 > l >>> 0) {
						Z = Xg(t | 0, u | 0, l | 0, j | 0) | 0;
						p = -(+(Z >>> 0) + 4294967296 * +(D >>> 0));
						break;
					} else {
						Z = Xg(l | 0, j | 0, t | 0, u | 0) | 0;
						p = +(Z >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
				} else {
					if (m) {
						Z = $g(t | 0, u | 0, l | 0, j | 0) | 0;
						p = +(Z >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
					if (u >>> 0 < j >>> 0 | (u | 0) == (j | 0) & t >>> 0 < l >>> 0) {
						Z = Xg(l | 0, j | 0, t | 0, u | 0) | 0;
						p = -(+(Z >>> 0) + 4294967296 * +(D >>> 0));
						break;
					} else {
						Z = Xg(t | 0, u | 0, l | 0, j | 0) | 0;
						p = +(Z >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
				} while (0);
				k = w * p;
				H = (H + K) * .5;
				p = ca * (H - +(B | 0));
				if (p < 0) {
					o = 0 - p;
					if (p > 0) {
						p = (p + 0) / o;
						if (p < 0) p = -p;
					} else p = 1;
					r = 0;
					v = 0;
					s = p + 1;
				} else {
					r = p + 0;
					v = 2;
					o = 0;
					s = 0;
				}
				S = (S + E) * .5;
				p = ba * (S - +(F | 0));
				do if (p < 0) {
					n = o - p;
					if (o < 0 | p > 0) {
						p = (o * s + p) / n;
						if (p < 0) p = -p;
					} else p = s < 1 ? 1 : s;
					s = p + 1;
					w = r;
				} else {
					q = r + p;
					if (r < 0 ? r > 0 | p > 0 : 0) {
						p = (r * v - p) / q;
						if (p < 0) p = -p;
						n = o;
						w = q;
						v = p + 1;
						break;
					}
					n = o;
					w = q;
					v = v < 1 ? 2 : v + 1;
				} while (0);
				q = +P(+k);
				m = q < 0;
				do if ((g | 0) == 2) {
					if (m) {
						r = w - q;
						if (w < 0 | q > 0) {
							o = (w * v + q * 2.5) / r;
							if (o < 0) o = -o;
						} else o = v < 2.5 ? 2.5 : v;
						p = s;
						q = o + 1;
						k = n;
						o = r;
						break;
					}
					k = n + q;
					if (n < 0 ? n > 0 | q > 0 : 0) {
						o = (n * s - q * 2.5) / k;
						if (o < 0) o = -o;
						p = o + 1;
						q = v;
						o = w;
						break;
					}
					p = s < 2.5 ? 3.5 : s + 1;
					q = v;
					o = w;
				} else {
					if (m) {
						k = n - q;
						if (n < 0 | q > 0) {
							o = (n * s + q * 2.5) / k;
							if (o < 0) o = -o;
						} else o = s < 2.5 ? 2.5 : s;
						p = o + 1;
						q = v;
						o = w;
						break;
					}
					r = w + q;
					if (w < 0 ? w > 0 | q > 0 : 0) {
						o = (w * v - q * 2.5) / r;
						if (o < 0) o = -o;
						p = s;
						q = o + 1;
						k = n;
						o = r;
						break;
					}
					p = s;
					q = v < 2.5 ? 3.5 : v + 1;
					k = n;
					o = r;
				} while (0);
				if ($ < 0) {
					C = -$;
					n = q;
					E = o / C;
					C = k / C;
				} else {
					n = p;
					p = q;
					E = k / $;
					C = o / $;
				}
				z = p + 3;
				A = n + 3;
				if (H < 0) {
					o = 0 - H;
					if (H > 0) {
						p = (H * 0 + 0) / o;
						if (p < 0) p = -p;
					} else p = 0;
					n = 0;
					v = 0;
					w = p + 1;
				} else {
					n = H + 0;
					v = 1;
					o = 0;
					w = 0;
				}
				if (ca < 0) {
					p = -ca;
					q = A;
					k = E * p;
					r = z;
					p = C * p;
				} else {
					q = z;
					k = ca * C;
					r = A;
					p = ca * E;
				}
				s = q + 0 + 1;
				q = r + 0 + 1;
				R = n + p;
				if (n < 0 | p < 0 ? n > 0 | p > 0 : 0) {
					p = (n * v - p * q) / R;
					if (p < 0) p = -p;
				} else p = v < q ? q : v;
				K = p + 1;
				L = o + k;
				if (o < 0 | k < 0 ? o > 0 | k > 0 : 0) {
					p = (o * w - k * s) / L;
					if (p < 0) p = -p;
				} else p = w < s ? s : w;
				H = p + 1;
				if (S < 0) {
					r = 0 - S;
					if (S > 0) {
						p = (S * 0 + 0) / r;
						if (p < 0) p = -p;
					} else p = 0;
					w = 0;
					s = 0;
					v = p + 1;
				} else {
					w = S + 0;
					s = 1;
					r = 0;
					v = 0;
				}
				if (ba < 0) {
					q = -ba;
					o = A;
					n = E * q;
					p = z;
					q = C * q;
				} else {
					o = z;
					n = ba * C;
					p = A;
					q = ba * E;
				}
				o = o + 0 + 1;
				p = p + 0 + 1;
				C = w + q;
				if (w < 0 | q < 0 ? w > 0 | q > 0 : 0) {
					p = (w * s - q * p) / C;
					if (p < 0) p = -p;
				} else p = s < p ? p : s;
				z = p + 1;
				A = r + n;
				do if (r < 0 | n < 0 ? r > 0 | n > 0 : 0) {
					o = (r * v - n * o) / A;
					if (!(o < 0)) break;
					o = -o;
				} else Ba = 127; while (0);
				if ((Ba | 0) == 127) o = v < o ? o : v;
				n = o + 1;
				o = X * .5 / +P(+$);
				m = o < 0;
				a: do if (X < 0) {
					if (m) {
						p = R - o;
						do if (R < 0 | o > 0) {
							o = (R * K + o * 5) / p;
							if (!(o < 0)) break;
							o = -o;
						} else o = K < 5 ? 5 : K; while (0);
						w = L;
						k = p;
						v = H;
						r = o + 1;
						break;
					}
					p = L + o;
					do if (L < 0) {
						if (!(L > 0 | o > 0)) break;
						o = (L * H - o * 5) / p;
						if (o < 0) o = -o;
						w = p;
						k = R;
						v = o + 1;
						r = K;
						break a;
					} while (0);
					w = p;
					k = R;
					v = H < 5 ? 6 : H + 1;
					r = K;
				} else {
					if (m) {
						p = L - o;
						do if (L < 0 | o > 0) {
							o = (L * H + o * 5) / p;
							if (!(o < 0)) break;
							o = -o;
						} else o = H < 5 ? 5 : H; while (0);
						w = p;
						k = R;
						v = o + 1;
						r = K;
						break;
					}
					p = R + o;
					do if (R < 0) {
						if (!(R > 0 | o > 0)) break;
						o = (R * K - o * 5) / p;
						if (o < 0) o = -o;
						w = L;
						k = p;
						v = H;
						r = o + 1;
						break a;
					} while (0);
					w = L;
					k = p;
					v = H;
					r = K < 5 ? 6 : K + 1;
				} while (0);
				s = R - L;
				do if (R < 0 | L > 0) {
					if (!(R > 0 | L < 0)) {
						Ba = 157;
						break;
					}
					o = (R * K + L * H) / s;
					if (!(o < 0)) break;
					o = -o;
				} else Ba = 157; while (0);
				if ((Ba | 0) == 157) o = K < H ? H : K;
				q = C - A;
				do if (C < 0 | A > 0) {
					if (!(C > 0 | A < 0)) {
						Ba = 162;
						break;
					}
					n = (C * z + A * n) / q;
					if (!(n < 0)) break;
					n = -n;
				} else Ba = 162; while (0);
				if ((Ba | 0) == 162) n = z < n ? n : z;
				p = k - w;
				do if (w > 0 | k < 0) {
					if (!(w < 0 | k > 0)) {
						Ba = 167;
						break;
					}
					k = (v * w + r * k) / p;
					if (!(k < 0)) break;
					k = -k;
				} else Ba = 167; while (0);
				if ((Ba | 0) == 167) k = r < v ? v : r;
				h[i >> 3] = s;
				h[i + 8 >> 3] = q;
				h[i + 16 >> 3] = p;
				a[i + 24 >> 0] = 1;
			} else {
				da = +P(+$);
				qa = +P(+(X * X + R * R));
				m = Xg(O | 0, Q | 0, Y | 0, Z | 0) | 0;
				x = D;
				l = (x | 0) < 0;
				Q = Xg(0, 0, m | 0, x | 0) | 0;
				x = l ? D : x;
				y = ih(ia | 0, ja | 0, wa | 0, xa | 0) | 0;
				t = D;
				x = ih((l ? Q : m) | 0, x | 0, ua | 0, va | 0) | 0;
				m = D;
				l = ya ^ l;
				do if (za ^ pa) {
					if (!l) {
						Q = $g(y | 0, t | 0, x | 0, m | 0) | 0;
						r = -(+(Q >>> 0) + 4294967296 * +(D >>> 0));
						break;
					}
					if (t >>> 0 > m >>> 0 | (t | 0) == (m | 0) & y >>> 0 > x >>> 0) {
						Q = Xg(y | 0, t | 0, x | 0, m | 0) | 0;
						r = -(+(Q >>> 0) + 4294967296 * +(D >>> 0));
						break;
					} else {
						Q = Xg(x | 0, m | 0, y | 0, t | 0) | 0;
						r = +(Q >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
				} else {
					if (l) {
						Q = $g(y | 0, t | 0, x | 0, m | 0) | 0;
						r = +(Q >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
					if (t >>> 0 < m >>> 0 | (t | 0) == (m | 0) & y >>> 0 < x >>> 0) {
						Q = Xg(x | 0, m | 0, y | 0, t | 0) | 0;
						r = -(+(Q >>> 0) + 4294967296 * +(D >>> 0));
						break;
					} else {
						Q = Xg(y | 0, t | 0, x | 0, m | 0) | 0;
						r = +(Q >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
				} while (0);
				if (!(r < 0)) {
					w = da * qa;
					s = w + r;
					if (w < 0 ? w > 0 | r > 0 : 0) {
						w = (r - w * 5) / s;
						if (w < 0) w = -w;
						ta = s;
						sa = w + 1;
					} else {
						ta = s;
						sa = 6;
					}
				} else {
					s = Aa * Aa;
					w = da * qa;
					q = w - r;
					if (w < 0 | r > 0) {
						w = (w * 5 + r) / q;
						if (w < 0) w = -w;
					} else w = 5;
					ta = s / q;
					sa = w + 1 + 3 + 1;
				}
				B = c[d + 4 >> 2] | 0;
				u = ((B | 0) < 0) << 31 >> 31;
				m = Xg(W | 0, T | 0, B | 0, u | 0) | 0;
				x = D;
				F = c[d >> 2] | 0;
				J = ((F | 0) < 0) << 31 >> 31;
				t = Xg(j | 0, U | 0, F | 0, J | 0) | 0;
				y = D;
				l = (x | 0) < 0;
				O = Xg(0, 0, m | 0, x | 0) | 0;
				x = l ? D : x;
				Q = (y | 0) < 0;
				N = Xg(0, 0, t | 0, y | 0) | 0;
				y = ih((Q ? N : t) | 0, (Q ? D : y) | 0, ua | 0, va | 0) | 0;
				t = D;
				x = ih((l ? O : m) | 0, x | 0, wa | 0, xa | 0) | 0;
				m = D;
				l = za ^ l;
				do if (ya ^ Q) {
					if (!l) {
						Q = $g(y | 0, t | 0, x | 0, m | 0) | 0;
						A = -(+(Q >>> 0) + 4294967296 * +(D >>> 0));
						break;
					}
					if (t >>> 0 > m >>> 0 | (t | 0) == (m | 0) & y >>> 0 > x >>> 0) {
						Q = Xg(y | 0, t | 0, x | 0, m | 0) | 0;
						A = -(+(Q >>> 0) + 4294967296 * +(D >>> 0));
						break;
					} else {
						Q = Xg(x | 0, m | 0, y | 0, t | 0) | 0;
						A = +(Q >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
				} else {
					if (l) {
						Q = $g(y | 0, t | 0, x | 0, m | 0) | 0;
						A = +(Q >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
					if (t >>> 0 < m >>> 0 | (t | 0) == (m | 0) & y >>> 0 < x >>> 0) {
						Q = Xg(x | 0, m | 0, y | 0, t | 0) | 0;
						A = -(+(Q >>> 0) + 4294967296 * +(D >>> 0));
						break;
					} else {
						Q = Xg(y | 0, t | 0, x | 0, m | 0) | 0;
						A = +(Q >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
				} while (0);
				m = Xg(aa | 0, _ | 0, F | 0, J | 0) | 0;
				x = D;
				t = Xg(Y | 0, Z | 0, B | 0, u | 0) | 0;
				y = D;
				l = (x | 0) < 0;
				O = Xg(0, 0, m | 0, x | 0) | 0;
				x = l ? D : x;
				Q = (y | 0) < 0;
				N = Xg(0, 0, t | 0, y | 0) | 0;
				y = ih((Q ? N : t) | 0, (Q ? D : y) | 0, ia | 0, ja | 0) | 0;
				t = D;
				x = ih((l ? O : m) | 0, x | 0, la | 0, ma | 0) | 0;
				m = D;
				l = oa ^ l;
				do if (pa ^ Q) {
					if (!l) {
						Q = $g(y | 0, t | 0, x | 0, m | 0) | 0;
						w = -(+(Q >>> 0) + 4294967296 * +(D >>> 0));
						break;
					}
					if (t >>> 0 > m >>> 0 | (t | 0) == (m | 0) & y >>> 0 > x >>> 0) {
						Q = Xg(y | 0, t | 0, x | 0, m | 0) | 0;
						w = -(+(Q >>> 0) + 4294967296 * +(D >>> 0));
						break;
					} else {
						Q = Xg(x | 0, m | 0, y | 0, t | 0) | 0;
						w = +(Q >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
				} else {
					if (l) {
						Q = $g(y | 0, t | 0, x | 0, m | 0) | 0;
						w = +(Q >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
					if (t >>> 0 < m >>> 0 | (t | 0) == (m | 0) & y >>> 0 < x >>> 0) {
						Q = Xg(x | 0, m | 0, y | 0, t | 0) | 0;
						w = -(+(Q >>> 0) + 4294967296 * +(D >>> 0));
						break;
					} else {
						Q = Xg(y | 0, t | 0, x | 0, m | 0) | 0;
						w = +(Q >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
				} while (0);
				ea = ta * 2 * A * w;
				fa = sa + 0 + 1 + 1 + 1 + 1 + 1;
				x = (W | 0) < 0;
				t = Xg(0, 0, W | 0, T | 0) | 0;
				y = x ? D : T;
				Q = (j | 0) < 0;
				m = Xg(0, 0, j | 0, U | 0) | 0;
				m = ih(ua | 0, va | 0, (Q ? m : j) | 0, (Q ? D : U) | 0) | 0;
				l = D;
				y = ih(wa | 0, xa | 0, (x ? t : W) | 0, y | 0) | 0;
				t = D;
				x = x ^ za;
				do if (Q ^ ya) {
					if (!x) {
						U = $g(y | 0, t | 0, m | 0, l | 0) | 0;
						K = -(+(U >>> 0) + 4294967296 * +(D >>> 0));
						break;
					}
					if (l >>> 0 > t >>> 0 | (l | 0) == (t | 0) & m >>> 0 > y >>> 0) {
						U = Xg(m | 0, l | 0, y | 0, t | 0) | 0;
						K = -(+(U >>> 0) + 4294967296 * +(D >>> 0));
						break;
					} else {
						U = Xg(y | 0, t | 0, m | 0, l | 0) | 0;
						K = +(U >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
				} else {
					if (x) {
						U = $g(y | 0, t | 0, m | 0, l | 0) | 0;
						K = +(U >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
					if (l >>> 0 < t >>> 0 | (l | 0) == (t | 0) & m >>> 0 < y >>> 0) {
						U = Xg(y | 0, t | 0, m | 0, l | 0) | 0;
						K = -(+(U >>> 0) + 4294967296 * +(D >>> 0));
						break;
					} else {
						U = Xg(m | 0, l | 0, y | 0, t | 0) | 0;
						K = +(U >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
				} while (0);
				x = (aa | 0) < 0;
				t = Xg(0, 0, aa | 0, _ | 0) | 0;
				y = x ? D : _;
				U = (Y | 0) < 0;
				m = Xg(0, 0, Y | 0, Z | 0) | 0;
				m = ih(ia | 0, ja | 0, (U ? m : Y) | 0, (U ? D : Z) | 0) | 0;
				l = D;
				y = ih(la | 0, ma | 0, (x ? t : aa) | 0, y | 0) | 0;
				t = D;
				x = x ^ oa;
				do if (U ^ pa) {
					if (!x) {
						Z = $g(y | 0, t | 0, m | 0, l | 0) | 0;
						E = -(+(Z >>> 0) + 4294967296 * +(D >>> 0));
						break;
					}
					if (l >>> 0 > t >>> 0 | (l | 0) == (t | 0) & m >>> 0 > y >>> 0) {
						Z = Xg(m | 0, l | 0, y | 0, t | 0) | 0;
						E = -(+(Z >>> 0) + 4294967296 * +(D >>> 0));
						break;
					} else {
						Z = Xg(y | 0, t | 0, m | 0, l | 0) | 0;
						E = +(Z >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
				} else {
					if (x) {
						Z = $g(y | 0, t | 0, m | 0, l | 0) | 0;
						E = +(Z >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
					if (l >>> 0 < t >>> 0 | (l | 0) == (t | 0) & m >>> 0 < y >>> 0) {
						Z = Xg(y | 0, t | 0, m | 0, l | 0) | 0;
						E = -(+(Z >>> 0) + 4294967296 * +(D >>> 0));
						break;
					} else {
						Z = Xg(m | 0, l | 0, y | 0, t | 0) | 0;
						E = +(Z >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
				} while (0);
				H = 1 / Aa;
				w = X * K * H;
				if (w < 0) {
					s = 0 - w;
					if (w > 0) {
						w = (w * 5 + 0) / s;
						if (w < 0) w = -w;
					} else w = 5;
					n = 0;
					v = 0;
					k = w + 1;
				} else {
					n = w + 0;
					v = 6;
					s = 0;
					k = 0;
				}
				w = ca * E * H;
				do if (w < 0) {
					A = s - w;
					if (w > 0 | s < 0) {
						w = (w * 5 + s * k) / A;
						if (w < 0) w = -w;
					} else w = k < 5 ? 5 : k;
					ka = v;
					na = w + 1;
					ga = n;
					ha = A;
				} else {
					A = w + n;
					if (n < 0 ? w > 0 | n > 0 : 0) {
						w = (n * v - w * 5) / A;
						if (w < 0) w = -w;
						ka = w + 1;
						na = k;
						ga = A;
						ha = s;
						break;
					}
					ka = v < 5 ? 6 : v + 1;
					na = k;
					ga = A;
					ha = s;
				} while (0);
				w = ba * E * H;
				if (w < 0) {
					A = 0 - w;
					if (w > 0) {
						w = (w * 5 + 0) / A;
						if (w < 0) w = -w;
					} else w = 5;
					C = 0;
					E = 0;
					v = w + 1;
				} else {
					C = w + 0;
					E = 6;
					A = 0;
					v = 0;
				}
				w = R * K * H;
				do if (w < 0) {
					k = A - w;
					if (w > 0 | A < 0) {
						w = (w * 5 + A * v) / k;
						if (w < 0) w = -w;
					} else w = v < 5 ? 5 : v;
					A = k;
					ra = w + 1;
				} else {
					k = w + C;
					if (C < 0 ? w > 0 | C > 0 : 0) {
						w = (C * E - w * 5) / k;
						if (w < 0) w = -w;
						C = k;
						E = w + 1;
						ra = v;
						break;
					}
					C = k;
					E = E < 5 ? 6 : E + 1;
					ra = v;
				} while (0);
				$ = ca * qa;
				aa = $ < 0;
				if (aa) {
					v = na;
					k = ka;
					z = -($ * ga);
					n = -($ * ha);
				} else {
					v = ka;
					k = na;
					z = $ * ha;
					n = $ * ga;
				}
				o = k + 3 + 1;
				k = v + 3 + 1;
				q = n + 0;
				if (n < 0 & n > 0) {
					k = (0 - n * k) / q;
					if (k < 0) k = -k;
				} else k = k > 0 ? k : 0;
				H = k + 1;
				r = z + 0;
				if (z < 0 & z > 0) {
					k = (0 - z * o) / r;
					if (k < 0) k = -k;
				} else k = o > 0 ? o : 0;
				p = k + 1;
				V = X * da;
				G = V < 0;
				if (G) {
					v = na;
					k = ka;
					z = -(V * ga);
					n = -(V * ha);
				} else {
					v = ka;
					k = na;
					z = V * ha;
					n = V * ga;
				}
				o = k + 3 + 1;
				k = v + 3 + 1;
				L = q + n;
				do if (q < 0 | n < 0 ? q > 0 | n > 0 : 0) {
					k = (q * H - n * k) / L;
					if (!(k < 0)) break;
					k = -k;
				} else Ba = 288; while (0);
				if ((Ba | 0) == 288) k = H < k ? k : H;
				q = k + 1;
				K = r + z;
				do if (r < 0 | z < 0) {
					if (!(r > 0 | z > 0)) {
						Ba = 293;
						break;
					}
					k = (r * p - z * o) / K;
					if (!(k < 0)) break;
					k = -k;
				} else Ba = 293; while (0);
				if ((Ba | 0) == 293) k = p < o ? o : p;
				H = k + 1;
				ca = ba * qa;
				W = ca < 0;
				if (W) {
					v = ra;
					k = E;
					z = -(ca * C);
					n = -(ca * A);
				} else {
					v = E;
					k = ra;
					z = ca * A;
					n = ca * C;
				}
				o = k + 3 + 1;
				k = v + 3 + 1;
				r = L + n;
				do if (L < 0 | n < 0) {
					if (!(L > 0 | n > 0)) {
						Ba = 301;
						break;
					}
					k = (L * q - n * k) / r;
					if (!(k < 0)) break;
					k = -k;
				} else Ba = 301; while (0);
				if ((Ba | 0) == 301) k = q < k ? k : q;
				p = k + 1;
				L = K + z;
				do if (K < 0 | z < 0) {
					if (!(K > 0 | z > 0)) {
						Ba = 306;
						break;
					}
					k = (K * H - z * o) / L;
					if (!(k < 0)) break;
					k = -k;
				} else Ba = 306; while (0);
				if ((Ba | 0) == 306) k = H < o ? o : H;
				z = k + 1;
				ba = R * da;
				_ = ba < 0;
				if (_) {
					v = ra;
					k = E;
					H = -(ba * C);
					n = -(ba * A);
				} else {
					v = E;
					k = ra;
					H = ba * A;
					n = ba * C;
				}
				o = k + 3 + 1;
				k = v + 3 + 1;
				S = r + n;
				do if (r < 0 | n < 0) {
					if (!(r > 0 | n > 0)) {
						Ba = 314;
						break;
					}
					k = (r * p - n * k) / S;
					if (!(k < 0)) break;
					k = -k;
				} else Ba = 314; while (0);
				if ((Ba | 0) == 314) k = p < k ? k : p;
				q = k + 1;
				K = L + H;
				do if (L < 0 | H < 0) {
					if (!(L > 0 | H > 0)) {
						Ba = 319;
						break;
					}
					k = (L * z - H * o) / K;
					if (!(k < 0)) break;
					k = -k;
				} else Ba = 319; while (0);
				if ((Ba | 0) == 319) k = z < o ? o : z;
				r = k + 1;
				N = 0 - B | 0;
				M = ((N | 0) < 0) << 31 >> 31;
				I = (B | 0) > 0;
				j = Xg(0, 0, N | 0, M | 0) | 0;
				N = I ? j : N;
				M = I ? D : M;
				j = (F | 0) < 0;
				O = Xg(0, 0, F | 0, J | 0) | 0;
				O = j ? O : F;
				Q = j ? D : J;
				F = ih(O | 0, Q | 0, ia | 0, ja | 0) | 0;
				x = D;
				y = ih(la | 0, ma | 0, N | 0, M | 0) | 0;
				t = D;
				B = I ^ oa;
				do if (pa ^ j) {
					if (!B) {
						Z = $g(F | 0, x | 0, y | 0, t | 0) | 0;
						k = -(+(Z >>> 0) + 4294967296 * +(D >>> 0));
						break;
					}
					if (x >>> 0 > t >>> 0 | (x | 0) == (t | 0) & F >>> 0 > y >>> 0) {
						Z = Xg(F | 0, x | 0, y | 0, t | 0) | 0;
						k = -(+(Z >>> 0) + 4294967296 * +(D >>> 0));
						break;
					} else {
						Z = Xg(y | 0, t | 0, F | 0, x | 0) | 0;
						k = +(Z >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
				} else {
					if (B) {
						Z = $g(F | 0, x | 0, y | 0, t | 0) | 0;
						k = +(Z >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
					if (x >>> 0 < t >>> 0 | (x | 0) == (t | 0) & F >>> 0 < y >>> 0) {
						Z = Xg(y | 0, t | 0, F | 0, x | 0) | 0;
						k = -(+(Z >>> 0) + 4294967296 * +(D >>> 0));
						break;
					} else {
						Z = Xg(F | 0, x | 0, y | 0, t | 0) | 0;
						k = +(Z >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
				} while (0);
				k = da * k;
				b: do if (k < 0) {
					n = S - k;
					do if (S < 0 | k > 0) {
						w = (S * q + k * 4) / n;
						if (!(w < 0)) break;
						w = -w;
					} else w = q < 4 ? 4 : q; while (0);
					v = K;
					q = w + 1;
				} else {
					v = K + k;
					do if (K < 0) {
						if (!(K > 0 | k > 0)) break;
						w = (K * r - k * 4) / v;
						if (w < 0) w = -w;
						r = w + 1;
						n = S;
						break b;
					} while (0);
					r = r < 4 ? 5 : r + 1;
					n = S;
				} while (0);
				m = ih(O | 0, Q | 0, wa | 0, xa | 0) | 0;
				l = D;
				t = ih(ua | 0, va | 0, N | 0, M | 0) | 0;
				x = D;
				y = I ^ ya;
				do if (za ^ j) {
					if (!y) {
						Z = $g(m | 0, l | 0, t | 0, x | 0) | 0;
						w = -(+(Z >>> 0) + 4294967296 * +(D >>> 0));
						break;
					}
					if (l >>> 0 > x >>> 0 | (l | 0) == (x | 0) & m >>> 0 > t >>> 0) {
						Z = Xg(m | 0, l | 0, t | 0, x | 0) | 0;
						w = -(+(Z >>> 0) + 4294967296 * +(D >>> 0));
						break;
					} else {
						Z = Xg(t | 0, x | 0, m | 0, l | 0) | 0;
						w = +(Z >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
				} else {
					if (y) {
						Z = $g(m | 0, l | 0, t | 0, x | 0) | 0;
						w = +(Z >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
					if (l >>> 0 < x >>> 0 | (l | 0) == (x | 0) & m >>> 0 < t >>> 0) {
						Z = Xg(t | 0, x | 0, m | 0, l | 0) | 0;
						w = -(+(Z >>> 0) + 4294967296 * +(D >>> 0));
						break;
					} else {
						Z = Xg(m | 0, l | 0, t | 0, x | 0) | 0;
						w = +(Z >>> 0) + 4294967296 * +(D >>> 0);
						break;
					}
				} while (0);
				w = qa * w;
				c: do if (w < 0) {
					p = n - w;
					do if (n < 0 | w > 0) {
						w = (n * q + w * 4) / p;
						if (!(w < 0)) break;
						w = -w;
					} else w = q < 4 ? 4 : q; while (0);
					s = v;
					q = w + 1;
				} else {
					s = v + w;
					do if (v < 0) {
						if (!(v > 0 | w > 0)) break;
						w = (v * r - w * 4) / s;
						if (w < 0) w = -w;
						r = w + 1;
						p = n;
						break c;
					} while (0);
					r = r < 4 ? 5 : r + 1;
					p = n;
				} while (0);
				o = s + 0;
				do if (s < 0 & s > 0) {
					w = (0 - s * r) / o;
					if (!(w < 0)) break;
					w = -w;
				} else w = r > 0 ? r : 0; while (0);
				z = w + 1;
				r = p + 0;
				do if (p < 0 & p > 0) {
					w = (0 - p * q) / r;
					if (!(w < 0)) break;
					w = -w;
				} else w = q > 0 ? q : 0; while (0);
				q = w + 1;
				s = +P(+ea);
				p = fa * .5 + 1;
				t = s < 0;
				d: do if ((g | 0) == 2) {
					if (t) {
						w = r - s;
						do if (r < 0 | s > 0) {
							s = (r * q + p * s) / w;
							if (!(s < 0)) break;
							s = -s;
						} else s = q < p ? p : q; while (0);
						q = s + 1;
						r = w;
						break;
					}
					w = o + s;
					do if (o < 0) {
						if (!(o > 0 | s > 0)) break;
						s = (o * z - p * s) / w;
						if (s < 0) s = -s;
						z = s + 1;
						o = w;
						break d;
					} while (0);
					z = (z < p ? p : z) + 1;
					o = w;
				} else {
					if (t) {
						w = o - s;
						do if (o < 0 | s > 0) {
							s = (o * z + p * s) / w;
							if (!(s < 0)) break;
							s = -s;
						} else s = z < p ? p : z; while (0);
						z = s + 1;
						o = w;
						break;
					}
					w = r + s;
					do if (r < 0) {
						if (!(r > 0 | s > 0)) break;
						s = (r * q - p * s) / w;
						if (s < 0) s = -s;
						q = s + 1;
						r = w;
						break d;
					} while (0);
					q = (q < p ? p : q) + 1;
					r = w;
				} while (0);
				w = ta * ta;
				s = sa + sa + 1;
				if (w < 0) {
					K = -w;
					L = s + 1;
					X = r / K;
					K = o / K;
					n = L + q;
					L = L + z;
				} else {
					L = s + 1;
					X = o / w;
					K = r / w;
					n = L + z;
					L = L + q;
				}
				if (aa) {
					w = L;
					s = n;
					p = -($ * X);
					r = -($ * K);
				} else {
					w = n;
					s = L;
					p = $ * K;
					r = $ * X;
				}
				q = s + 3 + 1;
				s = w + 3 + 1;
				k = ga + r;
				do if (ga < 0 | r < 0) {
					if (!(ga > 0 | r > 0)) {
						Ba = 409;
						break;
					}
					s = (ga * ka - r * s) / k;
					if (!(s < 0)) break;
					s = -s;
				} else Ba = 409; while (0);
				if ((Ba | 0) == 409) s = ka < s ? s : ka;
				v = s + 1;
				z = ha + p;
				do if (ha < 0 | p < 0) {
					if (!(ha > 0 | p > 0)) {
						Ba = 414;
						break;
					}
					r = (ha * na - p * q) / z;
					if (!(r < 0)) break;
					r = -r;
				} else Ba = 414; while (0);
				if ((Ba | 0) == 414) r = na < q ? q : na;
				o = r + 1;
				if (G) {
					r = L;
					s = n;
					p = -(V * X);
					q = -(V * K);
				} else {
					r = n;
					s = L;
					p = V * K;
					q = V * X;
				}
				w = s + 3 + 1;
				s = r + 3 + 1;
				$ = k + q;
				do if (k < 0 | q < 0) {
					if (!(k > 0 | q > 0)) {
						Ba = 422;
						break;
					}
					r = (k * v - q * s) / $;
					if (!(r < 0)) break;
					r = -r;
				} else Ba = 422; while (0);
				if ((Ba | 0) == 422) r = v < s ? s : v;
				R = r + 1;
				V = z + p;
				do if (z < 0 | p < 0) {
					if (!(z > 0 | p > 0)) {
						Ba = 427;
						break;
					}
					q = (z * o - p * w) / V;
					if (!(q < 0)) break;
					q = -q;
				} else Ba = 427; while (0);
				if ((Ba | 0) == 427) q = o < w ? w : o;
				S = q + 1;
				if (W) {
					s = L;
					r = n;
					p = -(ca * X);
					q = -(ca * K);
				} else {
					s = n;
					r = L;
					p = ca * K;
					q = ca * X;
				}
				w = r + 3 + 1;
				r = s + 3 + 1;
				z = C + q;
				do if (C < 0 | q < 0) {
					if (!(C > 0 | q > 0)) {
						Ba = 435;
						break;
					}
					q = (C * E - q * r) / z;
					if (!(q < 0)) break;
					q = -q;
				} else Ba = 435; while (0);
				if ((Ba | 0) == 435) q = E < r ? r : E;
				v = q + 1;
				k = A + p;
				do if (A < 0 | p < 0) {
					if (!(A > 0 | p > 0)) {
						Ba = 440;
						break;
					}
					p = (A * ra - p * w) / k;
					if (!(p < 0)) break;
					p = -p;
				} else Ba = 440; while (0);
				if ((Ba | 0) == 440) p = ra < w ? w : ra;
				o = p + 1;
				if (_) {
					q = L;
					r = n;
					w = -(ba * X);
					p = -(ba * K);
				} else {
					q = n;
					r = L;
					w = ba * K;
					p = ba * X;
				}
				s = r + 3 + 1;
				r = q + 3 + 1;
				H = z + p;
				do if (z < 0 | p < 0) {
					if (!(z > 0 | p > 0)) {
						Ba = 448;
						break;
					}
					p = (z * v - p * r) / H;
					if (!(p < 0)) break;
					p = -p;
				} else Ba = 448; while (0);
				if ((Ba | 0) == 448) p = v < r ? r : v;
				C = p + 1;
				A = k + w;
				do if (k < 0 | w < 0) {
					if (!(k > 0 | w > 0)) {
						Ba = 453;
						break;
					}
					p = (k * o - w * s) / A;
					if (!(p < 0)) break;
					p = -p;
				} else Ba = 453; while (0);
				if ((Ba | 0) == 453) p = o < s ? s : o;
				E = p + 1;
				if (X < K) {
					r = X;
					p = K;
					s = L;
				} else {
					r = K;
					p = X;
					s = n;
					n = L;
				}
				e: do if (Aa < 0) {
					r = Aa * r;
					o = Aa * p;
					p = s + 1 + 1;
					q = n + 1 + 1;
					s = $ - o;
					do if ($ < 0 | o > -0) {
						if (!($ > 0 | o < -0)) {
							Ba = 461;
							break;
						}
						p = ($ * R + o * p) / s;
						if (!(p < 0)) break;
						p = -p;
					} else Ba = 461; while (0);
					if ((Ba | 0) == 461) p = R < p ? p : R;
					n = p + 1;
					o = V - r;
					do if (V < 0 | r > -0) {
						if (!(V > 0 | r < -0)) break;
						p = (V * S + r * q) / o;
						if (!(p < 0)) {
							w = o;
							k = n;
							break e;
						}
						p = -p;
						w = o;
						k = n;
						break e;
					} while (0);
					p = S < q ? q : S;
					w = o;
					k = n;
				} else {
					q = Aa * p;
					k = Aa * r;
					r = n + 1 + 1;
					p = s + 1 + 1;
					s = $ + q;
					do if ($ < 0 | q < 0) {
						if (!($ > 0 | q > 0)) {
							Ba = 471;
							break;
						}
						p = ($ * R - q * p) / s;
						if (!(p < 0)) break;
						p = -p;
					} else Ba = 471; while (0);
					if ((Ba | 0) == 471) p = R < p ? p : R;
					q = p + 1;
					o = V + k;
					do if (V < 0 | k < 0) {
						if (!(V > 0 | k > 0)) break;
						p = (V * S - k * r) / o;
						if (!(p < 0)) {
							w = o;
							k = q;
							break e;
						}
						p = -p;
						w = o;
						k = q;
						break e;
					} while (0);
					p = S < r ? r : S;
					w = o;
					k = q;
				} while (0);
				r = p + 1;
				v = $ - V;
				do if ($ < 0 | V > 0) {
					if (!($ > 0 | V < 0)) {
						Ba = 481;
						break;
					}
					o = ($ * R + V * S) / v;
					if (!(o < 0)) break;
					o = -o;
				} else Ba = 481; while (0);
				if ((Ba | 0) == 481) o = R < S ? S : R;
				q = H - A;
				do if (H < 0 | A > 0) {
					if (!(H > 0 | A < 0)) {
						Ba = 486;
						break;
					}
					n = (H * C + A * E) / q;
					if (!(n < 0)) break;
					n = -n;
				} else Ba = 486; while (0);
				if ((Ba | 0) == 486) n = C < E ? E : C;
				p = s - w;
				do if (w > 0 | s < 0) {
					if (!(w < 0 | s > 0)) {
						Ba = 491;
						break;
					}
					k = (w * r + k * s) / p;
					if (!(k < 0)) break;
					k = -k;
				} else Ba = 491; while (0);
				if ((Ba | 0) == 491) k = k < r ? r : k;
				h[i >> 3] = v;
				h[i + 8 >> 3] = q;
				h[i + 16 >> 3] = p;
				a[i + 24 >> 0] = 1;
			}
			m = k + 1 > 64;
			l = n + 1 > 64;
			j = o + 1 > 64;
			if (!(j | l | m)) return;
			Hf(b, d, e, f, g, i, j, l, m);
			return;
		}
		function xf(b, d, e, f, g) {
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			g = g | 0;
			var i = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0, v = 0, w = 0, x = 0, y = 0, z = 0, A = 0, B = 0, C = 0, E = 0, F = 0, G = 0, H = 0, I = 0, J = 0, K = 0, L = 0, M = 0, N = 0, O = 0, Q = 0, R = 0, S = 0, T = 0, U = 0, V = 0, W = 0, X = 0, Y = 0, Z = 0, _ = 0, $ = 0, aa = 0, ba = 0, ca = 0, da = 0, ea = 0, fa = 0, ga = 0, ha = 0, ia = 0, ja = 0, ka = 0, la = 0, ma = 0, na = 0, oa = 0, pa = 0, qa = 0, ra = 0, sa = 0, ta = 0, ua = 0, va = 0, wa = 0, xa = 0, ya = 0, za = 0, Aa = 0;
			I = c[d + 8 >> 2] | 0;
			R = c[d >> 2] | 0;
			na = +(I | 0) - +(R | 0);
			S = c[d + 12 >> 2] | 0;
			F = c[d + 4 >> 2] | 0;
			va = +(S | 0) - +(F | 0);
			K = ((R | 0) < 0) << 31 >> 31;
			N = ((F | 0) < 0) << 31 >> 31;
			O = ((I | 0) < 0) << 31 >> 31;
			Q = ((S | 0) < 0) << 31 >> 31;
			T = (R | 0) < 0;
			k = Xg(0, 0, R | 0, K | 0) | 0;
			l = T ? D : K;
			o = (F | 0) < 0;
			L = Xg(0, 0, F | 0, N | 0) | 0;
			J = o ? D : N;
			H = (I | 0) < 0;
			n = Xg(0, 0, I | 0, O | 0) | 0;
			i = H ? D : O;
			U = (S | 0) < 0;
			M = Xg(0, 0, S | 0, Q | 0) | 0;
			l = ih((U ? M : S) | 0, (U ? D : Q) | 0, (T ? k : R) | 0, l | 0) | 0;
			k = D;
			i = ih((o ? L : F) | 0, J | 0, (H ? n : I) | 0, i | 0) | 0;
			n = D;
			o = H ^ o;
			do if (T ^ U) {
				if (!o) {
					U = $g(i | 0, n | 0, l | 0, k | 0) | 0;
					ta = -(+(U >>> 0) + 4294967296 * +(D >>> 0));
					break;
				}
				if (k >>> 0 > n >>> 0 | (k | 0) == (n | 0) & l >>> 0 > i >>> 0) {
					U = Xg(l | 0, k | 0, i | 0, n | 0) | 0;
					ta = -(+(U >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					U = Xg(i | 0, n | 0, l | 0, k | 0) | 0;
					ta = +(U >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} else {
				if (o) {
					U = $g(i | 0, n | 0, l | 0, k | 0) | 0;
					ta = +(U >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
				if (k >>> 0 < n >>> 0 | (k | 0) == (n | 0) & l >>> 0 < i >>> 0) {
					U = Xg(i | 0, n | 0, l | 0, k | 0) | 0;
					ta = -(+(U >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					U = Xg(l | 0, k | 0, i | 0, n | 0) | 0;
					ta = +(U >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} while (0);
			V = c[e + 8 >> 2] | 0;
			E = c[e >> 2] | 0;
			ca = +(V | 0) - +(E | 0);
			A = c[e + 12 >> 2] | 0;
			z = c[e + 4 >> 2] | 0;
			pa = +(A | 0) - +(z | 0);
			M = ((E | 0) < 0) << 31 >> 31;
			L = ((z | 0) < 0) << 31 >> 31;
			J = ((V | 0) < 0) << 31 >> 31;
			H = ((A | 0) < 0) << 31 >> 31;
			T = (E | 0) < 0;
			n = Xg(0, 0, E | 0, M | 0) | 0;
			o = T ? D : M;
			i = (z | 0) < 0;
			Y = Xg(0, 0, z | 0, L | 0) | 0;
			X = i ? D : L;
			W = (V | 0) < 0;
			k = Xg(0, 0, V | 0, J | 0) | 0;
			l = W ? D : J;
			U = (A | 0) < 0;
			Z = Xg(0, 0, A | 0, H | 0) | 0;
			o = ih((U ? Z : A) | 0, (U ? D : H) | 0, (T ? n : E) | 0, o | 0) | 0;
			n = D;
			l = ih((i ? Y : z) | 0, X | 0, (W ? k : V) | 0, l | 0) | 0;
			k = D;
			i = W ^ i;
			do if (T ^ U) {
				if (!i) {
					U = $g(l | 0, k | 0, o | 0, n | 0) | 0;
					qa = -(+(U >>> 0) + 4294967296 * +(D >>> 0));
					break;
				}
				if (n >>> 0 > k >>> 0 | (n | 0) == (k | 0) & o >>> 0 > l >>> 0) {
					U = Xg(o | 0, n | 0, l | 0, k | 0) | 0;
					qa = -(+(U >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					U = Xg(l | 0, k | 0, o | 0, n | 0) | 0;
					qa = +(U >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} else {
				if (i) {
					U = $g(l | 0, k | 0, o | 0, n | 0) | 0;
					qa = +(U >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
				if (n >>> 0 < k >>> 0 | (n | 0) == (k | 0) & o >>> 0 < l >>> 0) {
					U = Xg(l | 0, k | 0, o | 0, n | 0) | 0;
					qa = -(+(U >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					U = Xg(o | 0, n | 0, l | 0, k | 0) | 0;
					qa = +(U >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} while (0);
			W = c[f + 8 >> 2] | 0;
			X = c[f >> 2] | 0;
			la = +(W | 0) - +(X | 0);
			Y = c[f + 12 >> 2] | 0;
			Z = c[f + 4 >> 2] | 0;
			sa = +(Y | 0) - +(Z | 0);
			_ = ((X | 0) < 0) << 31 >> 31;
			$ = ((Z | 0) < 0) << 31 >> 31;
			aa = ((W | 0) < 0) << 31 >> 31;
			ba = ((Y | 0) < 0) << 31 >> 31;
			T = (X | 0) < 0;
			n = Xg(0, 0, X | 0, _ | 0) | 0;
			o = T ? D : _;
			i = (Z | 0) < 0;
			za = Xg(0, 0, Z | 0, $ | 0) | 0;
			ya = i ? D : $;
			xa = (W | 0) < 0;
			k = Xg(0, 0, W | 0, aa | 0) | 0;
			l = xa ? D : aa;
			U = (Y | 0) < 0;
			Aa = Xg(0, 0, Y | 0, ba | 0) | 0;
			o = ih((U ? Aa : Y) | 0, (U ? D : ba) | 0, (T ? n : X) | 0, o | 0) | 0;
			n = D;
			l = ih((i ? za : Z) | 0, ya | 0, (xa ? k : W) | 0, l | 0) | 0;
			k = D;
			i = xa ^ i;
			do if (T ^ U) {
				if (!i) {
					U = $g(l | 0, k | 0, o | 0, n | 0) | 0;
					ua = -(+(U >>> 0) + 4294967296 * +(D >>> 0));
					break;
				}
				if (n >>> 0 > k >>> 0 | (n | 0) == (k | 0) & o >>> 0 > l >>> 0) {
					U = Xg(o | 0, n | 0, l | 0, k | 0) | 0;
					ua = -(+(U >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					U = Xg(l | 0, k | 0, o | 0, n | 0) | 0;
					ua = +(U >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} else {
				if (i) {
					U = $g(l | 0, k | 0, o | 0, n | 0) | 0;
					ua = +(U >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
				if (n >>> 0 < k >>> 0 | (n | 0) == (k | 0) & o >>> 0 < l >>> 0) {
					U = Xg(l | 0, k | 0, o | 0, n | 0) | 0;
					ua = -(+(U >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					U = Xg(o | 0, n | 0, l | 0, k | 0) | 0;
					ua = +(U >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} while (0);
			v = na * na;
			t = va * va;
			x = v + t;
			if (v < 0 | t < 0 ? v > 0 | t > 0 : 0) {
				v = (v - t) / x;
				if (v < 0) v = -v;
			} else v = 1;
			oa = +P(+x);
			ea = (v + 1) * .5 + 1;
			x = ca * ca;
			j = pa * pa;
			y = x + j;
			if (x < 0 | j < 0 ? x > 0 | j > 0 : 0) {
				v = (x - j) / y;
				if (v < 0) v = -v;
			} else v = 1;
			ra = +P(+y);
			da = (v + 1) * .5 + 1;
			y = la * la;
			x = sa * sa;
			C = y + x;
			if (y < 0 | x < 0 ? y > 0 | x > 0 : 0) {
				y = (y - x) / C;
				if (y < 0) y = -y;
			} else y = 1;
			ma = +P(+C);
			fa = (y + 1) * .5 + 1;
			O = Xg(I | 0, O | 0, R | 0, K | 0) | 0;
			T = D;
			Q = Xg(S | 0, Q | 0, F | 0, N | 0) | 0;
			R = D;
			J = Xg(V | 0, J | 0, E | 0, M | 0) | 0;
			K = D;
			L = Xg(A | 0, H | 0, z | 0, L | 0) | 0;
			M = D;
			U = (T | 0) < 0;
			S = Xg(0, 0, O | 0, T | 0) | 0;
			S = U ? S : O;
			T = U ? D : T;
			V = (R | 0) < 0;
			O = Xg(0, 0, Q | 0, R | 0) | 0;
			Q = V ? O : Q;
			R = V ? D : R;
			O = (K | 0) < 0;
			N = Xg(0, 0, J | 0, K | 0) | 0;
			J = O ? N : J;
			K = O ? D : K;
			N = (M | 0) < 0;
			o = Xg(0, 0, L | 0, M | 0) | 0;
			L = N ? o : L;
			M = N ? D : M;
			o = ih(L | 0, M | 0, S | 0, T | 0) | 0;
			n = D;
			l = ih(J | 0, K | 0, Q | 0, R | 0) | 0;
			k = D;
			i = V ^ O;
			do if (U ^ N) {
				if (!i) {
					za = $g(o | 0, n | 0, l | 0, k | 0) | 0;
					B = -(+(za >>> 0) + 4294967296 * +(D >>> 0));
					break;
				}
				if (n >>> 0 > k >>> 0 | (n | 0) == (k | 0) & o >>> 0 > l >>> 0) {
					za = Xg(o | 0, n | 0, l | 0, k | 0) | 0;
					B = -(+(za >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					za = Xg(l | 0, k | 0, o | 0, n | 0) | 0;
					B = +(za >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} else {
				if (i) {
					za = $g(o | 0, n | 0, l | 0, k | 0) | 0;
					B = +(za >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
				if (n >>> 0 < k >>> 0 | (n | 0) == (k | 0) & o >>> 0 < l >>> 0) {
					za = Xg(l | 0, k | 0, o | 0, n | 0) | 0;
					B = -(+(za >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					za = Xg(o | 0, n | 0, l | 0, k | 0) | 0;
					B = +(za >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} while (0);
			z = Xg(W | 0, aa | 0, X | 0, _ | 0) | 0;
			A = D;
			E = Xg(Y | 0, ba | 0, Z | 0, $ | 0) | 0;
			F = D;
			I = (A | 0) < 0;
			H = Xg(0, 0, z | 0, A | 0) | 0;
			z = I ? H : z;
			A = I ? D : A;
			H = (F | 0) < 0;
			k = Xg(0, 0, E | 0, F | 0) | 0;
			E = H ? k : E;
			F = H ? D : F;
			k = ih(E | 0, F | 0, J | 0, K | 0) | 0;
			i = D;
			n = ih(z | 0, A | 0, L | 0, M | 0) | 0;
			l = D;
			o = N ^ I;
			do if (O ^ H) {
				if (!o) {
					O = $g(k | 0, i | 0, n | 0, l | 0) | 0;
					C = -(+(O >>> 0) + 4294967296 * +(D >>> 0));
					break;
				}
				if (i >>> 0 > l >>> 0 | (i | 0) == (l | 0) & k >>> 0 > n >>> 0) {
					O = Xg(k | 0, i | 0, n | 0, l | 0) | 0;
					C = -(+(O >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					O = Xg(n | 0, l | 0, k | 0, i | 0) | 0;
					C = +(O >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} else {
				if (o) {
					O = $g(k | 0, i | 0, n | 0, l | 0) | 0;
					C = +(O >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
				if (i >>> 0 < l >>> 0 | (i | 0) == (l | 0) & k >>> 0 < n >>> 0) {
					O = Xg(n | 0, l | 0, k | 0, i | 0) | 0;
					C = -(+(O >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					O = Xg(k | 0, i | 0, n | 0, l | 0) | 0;
					C = +(O >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} while (0);
			k = ih(Q | 0, R | 0, z | 0, A | 0) | 0;
			i = D;
			n = ih(S | 0, T | 0, E | 0, F | 0) | 0;
			l = D;
			o = H ^ U;
			do if (I ^ V) {
				if (!o) {
					U = $g(k | 0, i | 0, n | 0, l | 0) | 0;
					G = -(+(U >>> 0) + 4294967296 * +(D >>> 0));
					break;
				}
				if (i >>> 0 > l >>> 0 | (i | 0) == (l | 0) & k >>> 0 > n >>> 0) {
					U = Xg(k | 0, i | 0, n | 0, l | 0) | 0;
					G = -(+(U >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					U = Xg(n | 0, l | 0, k | 0, i | 0) | 0;
					G = +(U >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} else {
				if (o) {
					U = $g(k | 0, i | 0, n | 0, l | 0) | 0;
					G = +(U >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
				if (i >>> 0 < l >>> 0 | (i | 0) == (l | 0) & k >>> 0 < n >>> 0) {
					U = Xg(n | 0, l | 0, k | 0, i | 0) | 0;
					G = -(+(U >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					U = Xg(k | 0, i | 0, n | 0, l | 0) | 0;
					G = +(U >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} while (0);
			r = ma * B;
			q = fa + 1 + 1;
			if (r < 0) {
				s = 0 - r;
				if (r > 0) {
					r = (q * r + 0) / s;
					if (r < 0) r = -r;
				} else r = q > 0 ? q : 0;
				t = 0;
				u = 0;
				j = r + 1;
			} else {
				t = r + 0;
				u = q > 0 ? q + 1 : 1;
				s = 0;
				j = 0;
			}
			r = oa * C;
			q = ea + 1 + 1;
			do if (r < 0) {
				m = s - r;
				if (r > 0 | s < 0) {
					r = (q * r + s * j) / m;
					if (r < 0) r = -r;
				} else r = j < q ? q : j;
				p = t;
				s = m;
				j = r + 1;
			} else {
				p = r + t;
				if (t < 0 ? r > 0 | t > 0 : 0) {
					r = (t * u - q * r) / p;
					if (r < 0) r = -r;
					u = r + 1;
					break;
				}
				u = (u < q ? q : u) + 1;
			} while (0);
			r = ra * G;
			m = da + 1 + 1;
			do if (r < 0) {
				q = s - r;
				if (r > 0 | s < 0) {
					r = (m * r + s * j) / q;
					if (r < 0) r = -r;
				} else r = j < m ? m : j;
				ka = q;
				ja = p;
				ia = r + 1;
			} else {
				q = r + p;
				if (p < 0 ? r > 0 | p > 0 : 0) {
					r = (p * u - m * r) / q;
					if (r < 0) r = -r;
					ka = s;
					ja = q;
					ia = j;
					u = r + 1;
					break;
				}
				ka = s;
				ja = q;
				ia = j;
				u = (u < m ? m : u) + 1;
			} while (0);
			r = ua * B;
			if (r < 0) {
				s = 0 - r;
				if (r > 0) {
					r = (r * 3 + 0) / s;
					if (r < 0) r = -r;
				} else r = 3;
				q = 0;
				m = 0;
				t = s;
				p = r + 1;
			} else {
				q = r + 0;
				m = 4;
				t = 0;
				p = 0;
			}
			s = ta * C;
			do if (s < 0) {
				r = t - s;
				if (s > 0 | t < 0) {
					s = (s * 3 + t * p) / r;
					if (s < 0) s = -s;
				} else s = p < 3 ? 3 : p;
				v = q;
				t = r;
				p = s + 1;
			} else {
				r = s + q;
				if (q < 0 ? s > 0 | q > 0 : 0) {
					s = (q * m - s * 3) / r;
					if (s < 0) s = -s;
					v = r;
					m = s + 1;
					break;
				}
				v = r;
				m = m < 3 ? 4 : m + 1;
			} while (0);
			s = qa * G;
			do if (s < 0) {
				q = t - s;
				if (s > 0 | t < 0) {
					r = (s * 3 + t * p) / q;
					if (r < 0) r = -r;
				} else r = p < 3 ? 3 : p;
				w = q;
				x = r + 1;
				ha = v;
				ga = m;
			} else {
				q = s + v;
				if (v < 0 ? s > 0 | v > 0 : 0) {
					r = (v * m - s * 3) / q;
					if (r < 0) r = -r;
					w = t;
					x = p;
					ha = q;
					ga = r + 1;
					break;
				}
				w = t;
				x = p;
				ha = q;
				ga = m < 3 ? 4 : m + 1;
			} while (0);
			s = na * qa * ma;
			G = fa + 2 + 1;
			if (s < 0) {
				r = 0 - s;
				if (s > 0) {
					s = (s * G + 0) / r;
					if (s < 0) s = -s;
				} else s = G > 0 ? G : 0;
				m = s + 1;
				p = 0;
				v = 0;
			} else {
				r = 0;
				m = 0;
				p = s + 0;
				v = G > 0 ? G + 1 : 1;
			}
			s = ta * ca * ma;
			a: do if (s < 0) {
				t = p - s;
				do if (s > 0 | p < 0) {
					s = (s * G + p * v) / t;
					if (!(s < 0)) break;
					s = -s;
				} else s = v < G ? G : v; while (0);
				v = s + 1;
			} else {
				q = s + r;
				do if (r < 0) {
					if (!(s > 0 | r > 0)) break;
					s = (r * m - s * G) / q;
					if (s < 0) s = -s;
					t = p;
					r = q;
					m = s + 1;
					break a;
				} while (0);
				t = p;
				r = q;
				m = (m < G ? G : m) + 1;
			} while (0);
			s = ca * ua * oa;
			B = ea + 2 + 1;
			b: do if (s < 0) {
				q = r - s;
				do if (s > 0 | r < 0) {
					s = (s * B + r * m) / q;
					if (!(s < 0)) break;
					s = -s;
				} else s = m < B ? B : m; while (0);
				r = q;
				m = s + 1;
			} else {
				q = s + t;
				do if (t < 0) {
					if (!(s > 0 | t > 0)) break;
					s = (t * v - s * B) / q;
					if (s < 0) s = -s;
					t = q;
					v = s + 1;
					break b;
				} while (0);
				t = q;
				v = (v < B ? B : v) + 1;
			} while (0);
			s = qa * la * oa;
			c: do if (s < 0) {
				q = t - s;
				do if (s > 0 | t < 0) {
					s = (s * B + t * v) / q;
					if (!(s < 0)) break;
					s = -s;
				} else s = v < B ? B : v; while (0);
				t = q;
				v = s + 1;
			} else {
				q = s + r;
				do if (r < 0) {
					if (!(s > 0 | r > 0)) break;
					s = (r * m - s * B) / q;
					if (s < 0) s = -s;
					r = q;
					m = s + 1;
					break c;
				} while (0);
				r = q;
				m = (m < B ? B : m) + 1;
			} while (0);
			s = ta * la * ra;
			C = da + 2 + 1;
			d: do if (s < 0) {
				q = r - s;
				do if (s > 0 | r < 0) {
					s = (s * C + r * m) / q;
					if (!(s < 0)) break;
					s = -s;
				} else s = m < C ? C : m; while (0);
				r = q;
				m = s + 1;
			} else {
				q = s + t;
				do if (t < 0) {
					if (!(s > 0 | t > 0)) break;
					s = (t * v - s * C) / q;
					if (s < 0) s = -s;
					t = q;
					v = s + 1;
					break d;
				} while (0);
				t = q;
				v = (v < C ? C : v) + 1;
			} while (0);
			s = na * ua * ra;
			e: do if (s < 0) {
				q = t - s;
				do if (s > 0 | t < 0) {
					s = (s * C + t * v) / q;
					if (!(s < 0)) break;
					s = -s;
				} else s = v < C ? C : v; while (0);
				fa = q;
				ea = r;
				da = m;
				ca = s + 1;
			} else {
				q = s + r;
				do if (r < 0) {
					if (!(s > 0 | r > 0)) break;
					s = (r * m - s * C) / q;
					if (s < 0) s = -s;
					fa = t;
					ea = q;
					da = s + 1;
					ca = v;
					break e;
				} while (0);
				fa = t;
				ea = q;
				da = (m < C ? C : m) + 1;
				ca = v;
			} while (0);
			s = va * qa * ma;
			if (s < 0) {
				r = 0 - s;
				do if (s > 0) {
					s = (s * G + 0) / r;
					if (!(s < 0)) break;
					s = -s;
				} else s = G > 0 ? G : 0; while (0);
				p = s + 1;
				q = 0;
				j = 0;
			} else {
				r = 0;
				p = 0;
				q = s + 0;
				j = G > 0 ? G + 1 : 1;
			}
			s = ta * pa * ma;
			f: do if (s < 0) {
				t = q - s;
				do if (s > 0 | q < 0) {
					s = (s * G + q * j) / t;
					if (!(s < 0)) break;
					s = -s;
				} else s = j < G ? G : j; while (0);
				y = t;
				j = s + 1;
			} else {
				t = s + r;
				do if (r < 0) {
					if (!(s > 0 | r > 0)) break;
					s = (r * p - s * G) / t;
					if (s < 0) s = -s;
					y = q;
					r = t;
					p = s + 1;
					break f;
				} while (0);
				y = q;
				r = t;
				p = (p < G ? G : p) + 1;
			} while (0);
			s = pa * ua * oa;
			g: do if (s < 0) {
				q = r - s;
				do if (s > 0 | r < 0) {
					s = (s * B + r * p) / q;
					if (!(s < 0)) break;
					s = -s;
				} else s = p < B ? B : p; while (0);
				t = q;
				p = s + 1;
				m = y;
			} else {
				m = s + y;
				do if (y < 0) {
					if (!(s > 0 | y > 0)) break;
					s = (y * j - s * B) / m;
					if (s < 0) s = -s;
					t = r;
					j = s + 1;
					break g;
				} while (0);
				t = r;
				j = (j < B ? B : j) + 1;
			} while (0);
			s = qa * sa * oa;
			h: do if (s < 0) {
				q = m - s;
				do if (s > 0 | m < 0) {
					r = (s * B + m * j) / q;
					if (!(r < 0)) break;
					r = -r;
				} else r = j < B ? B : j; while (0);
				m = q;
				j = r + 1;
			} else {
				q = s + t;
				do if (t < 0) {
					if (!(s > 0 | t > 0)) break;
					r = (t * p - s * B) / q;
					if (r < 0) r = -r;
					t = q;
					p = r + 1;
					break h;
				} while (0);
				t = q;
				p = (p < B ? B : p) + 1;
			} while (0);
			r = ta * sa * ra;
			i: do if (r < 0) {
				s = t - r;
				do if (r > 0 | t < 0) {
					r = (r * C + t * p) / s;
					if (!(r < 0)) break;
					r = -r;
				} else r = p < C ? C : p; while (0);
				t = r + 1;
			} else {
				q = r + m;
				do if (m < 0) {
					if (!(r > 0 | m > 0)) break;
					r = (m * j - r * C) / q;
					if (r < 0) r = -r;
					s = t;
					t = p;
					m = q;
					j = r + 1;
					break i;
				} while (0);
				s = t;
				t = p;
				m = q;
				j = (j < C ? C : j) + 1;
			} while (0);
			r = va * ua * ra;
			j: do if (r < 0) {
				q = m - r;
				do if (r > 0 | m < 0) {
					p = (r * C + m * j) / q;
					if (!(p < 0)) break;
					p = -p;
				} else p = j < C ? C : j; while (0);
				G = s;
				B = q;
				p = p + 1;
			} else {
				q = r + s;
				do if (s < 0) {
					if (!(r > 0 | s > 0)) break;
					p = (s * t - r * C) / q;
					if (p < 0) p = -p;
					G = q;
					B = m;
					t = p + 1;
					p = j;
					break j;
				} while (0);
				G = q;
				B = m;
				t = (t < C ? C : t) + 1;
				p = j;
			} while (0);
			C = w + fa;
			n = fa < 0;
			do if (w < 0 | n) {
				if (!(w > 0 | fa > 0)) {
					wa = 276;
					break;
				}
				q = (fa * ca - w * x) / C;
				if (!(q < 0)) break;
				q = -q;
			} else wa = 276; while (0);
			if ((wa | 0) == 276) q = ca < x ? x : ca;
			x = q + 1;
			w = ha + ea;
			o = ea < 0;
			do if (ha < 0 | o) {
				if (!(ha > 0 | ea > 0)) {
					wa = 281;
					break;
				}
				q = (ea * da - ha * ga) / w;
				if (!(q < 0)) break;
				q = -q;
			} else wa = 281; while (0);
			if ((wa | 0) == 281) q = da < ga ? ga : da;
			v = q + 1;
			y = ja - ka;
			do if (ja < 0 | ka > 0) {
				if (!(ja > 0 | ka < 0)) {
					wa = 286;
					break;
				}
				m = (ja * u + ka * ia) / y;
				if (!(m < 0)) break;
				m = -m;
			} else wa = 286; while (0);
			if ((wa | 0) == 286) m = u < ia ? ia : u;
			u = m + 1;
			q = fa - ea;
			do if ((n | ea > 0) & (fa > 0 | o)) {
				j = (fa * ca + ea * da) / q;
				if (!(j < 0)) break;
				j = -j;
			} else j = ca < da ? da : ca; while (0);
			s = q / y;
			r = u + (j + 1) + 1;
			m = B - G;
			do if (B < 0 | G > 0) {
				if (!(B > 0 | G < 0)) {
					wa = 295;
					break;
				}
				j = (B * p + G * t) / m;
				if (!(j < 0)) break;
				j = -j;
			} else wa = 295; while (0);
			if ((wa | 0) == 295) j = p < t ? t : p;
			q = m / y;
			m = u + (j + 1) + 1;
			p = C - w;
			do if (C < 0 | w > 0) {
				if (!(C > 0 | w < 0)) {
					wa = 300;
					break;
				}
				j = (C * x + w * v) / p;
				if (!(j < 0)) break;
				j = -j;
			} else wa = 300; while (0);
			if ((wa | 0) == 300) j = x < v ? v : x;
			l = r > 64;
			k = m > 64;
			i = u + (j + 1) + 1 > 64;
			h[g >> 3] = s;
			h[g + 8 >> 3] = q;
			h[g + 16 >> 3] = p / y;
			a[g + 24 >> 0] = 1;
			if (!(l | k | i)) return;
			If(b, d, e, f, g, l, k, i);
			return;
		}
		function yf(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0, l = 0, m = 0;
			k = a + 4 | 0;
			l = c[a >> 2] | 0;
			e = ((c[k >> 2] | 0) - l >> 2) + 1 | 0;
			if (e >>> 0 > 1073741823) $f(a);
			m = a + 8 | 0;
			f = l;
			d = (c[m >> 2] | 0) - f | 0;
			if (d >> 2 >>> 0 < 536870911) {
				d = d >> 1;
				e = d >>> 0 < e >>> 0 ? e : d;
				d = (c[k >> 2] | 0) - f | 0;
				f = d >> 2;
				if (!e) {
					i = 0;
					h = 0;
					g = f;
					e = d;
				} else j = 6;
			} else {
				d = (c[k >> 2] | 0) - f | 0;
				e = 1073741823;
				f = d >> 2;
				j = 6;
			}
			if ((j | 0) == 6) {
				i = e;
				h = bg(e << 2) | 0;
				g = f;
				e = d;
			}
			f = h + (g << 2) | 0;
			if (f) c[f >> 2] = c[b >> 2];
			bh(h | 0, l | 0, e | 0) | 0;
			c[a >> 2] = h;
			c[k >> 2] = h + (g + 1 << 2);
			c[m >> 2] = h + (i << 2);
			if (!l) return;
			cg(l);
			return;
		}
		function zf(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0, l = 0, m = 0;
			k = a + 4 | 0;
			l = c[a >> 2] | 0;
			e = (((c[k >> 2] | 0) - l | 0) / 24 | 0) + 1 | 0;
			if (e >>> 0 > 178956970) $f(a);
			m = a + 8 | 0;
			f = l;
			d = ((c[m >> 2] | 0) - f | 0) / 24 | 0;
			if (d >>> 0 < 89478485) {
				d = d << 1;
				e = d >>> 0 < e >>> 0 ? e : d;
				d = (c[k >> 2] | 0) - f | 0;
				f = (d | 0) / 24 | 0;
				if (!e) {
					i = 0;
					h = 0;
					g = f;
					e = d;
				} else j = 6;
			} else {
				d = (c[k >> 2] | 0) - f | 0;
				e = 178956970;
				f = (d | 0) / 24 | 0;
				j = 6;
			}
			if ((j | 0) == 6) {
				i = e;
				h = bg(e * 24 | 0) | 0;
				g = f;
				e = d;
			}
			f = h + (g * 24 | 0) | 0;
			if (f) {
				c[f + 0 >> 2] = c[b + 0 >> 2];
				c[f + 4 >> 2] = c[b + 4 >> 2];
				c[f + 8 >> 2] = c[b + 8 >> 2];
				c[f + 12 >> 2] = c[b + 12 >> 2];
				c[f + 16 >> 2] = c[b + 16 >> 2];
				c[f + 20 >> 2] = c[b + 20 >> 2];
			}
			j = h + ((((e | 0) / -24 | 0) + g | 0) * 24 | 0) | 0;
			bh(j | 0, l | 0, e | 0) | 0;
			c[a >> 2] = j;
			c[k >> 2] = h + ((g + 1 | 0) * 24 | 0);
			c[m >> 2] = h + (i * 24 | 0);
			if (!l) return;
			cg(l);
			return;
		}
		function Af(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0, l = 0, m = 0;
			k = a + 4 | 0;
			l = c[a >> 2] | 0;
			e = (((c[k >> 2] | 0) - l | 0) / 24 | 0) + 1 | 0;
			if (e >>> 0 > 178956970) $f(a);
			m = a + 8 | 0;
			f = l;
			d = ((c[m >> 2] | 0) - f | 0) / 24 | 0;
			if (d >>> 0 < 89478485) {
				d = d << 1;
				e = d >>> 0 < e >>> 0 ? e : d;
				d = (c[k >> 2] | 0) - f | 0;
				f = (d | 0) / 24 | 0;
				if (!e) {
					i = 0;
					h = 0;
					g = f;
					e = d;
				} else j = 6;
			} else {
				d = (c[k >> 2] | 0) - f | 0;
				e = 178956970;
				f = (d | 0) / 24 | 0;
				j = 6;
			}
			if ((j | 0) == 6) {
				i = e;
				h = bg(e * 24 | 0) | 0;
				g = f;
				e = d;
			}
			f = h + (g * 24 | 0) | 0;
			if (f) {
				c[f + 0 >> 2] = c[b + 0 >> 2];
				c[f + 4 >> 2] = c[b + 4 >> 2];
				c[f + 8 >> 2] = c[b + 8 >> 2];
				c[f + 12 >> 2] = c[b + 12 >> 2];
				c[f + 16 >> 2] = c[b + 16 >> 2];
				c[f + 20 >> 2] = c[b + 20 >> 2];
			}
			j = h + ((((e | 0) / -24 | 0) + g | 0) * 24 | 0) | 0;
			bh(j | 0, l | 0, e | 0) | 0;
			c[a >> 2] = j;
			c[k >> 2] = h + ((g + 1 | 0) * 24 | 0);
			c[m >> 2] = h + (i * 24 | 0);
			if (!l) return;
			cg(l);
			return;
		}
		function Bf(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0, l = 0, m = 0;
			e = a + 4 | 0;
			if (!b) {
				d = c[a >> 2] | 0;
				c[a >> 2] = 0;
				if (d) cg(d);
				c[e >> 2] = 0;
				return;
			}
			m = bg(b << 2) | 0;
			d = c[a >> 2] | 0;
			c[a >> 2] = m;
			if (d) cg(d);
			c[e >> 2] = b;
			d = 0;
			do {
				c[(c[a >> 2] | 0) + (d << 2) >> 2] = 0;
				d = d + 1 | 0;
			} while ((d | 0) != (b | 0));
			d = a + 8 | 0;
			g = c[d >> 2] | 0;
			if (!g) return;
			e = c[g + 4 >> 2] | 0;
			l = b + -1 | 0;
			m = (l & b | 0) == 0;
			if (m) f = e & l; else f = (e >>> 0) % (b >>> 0) | 0;
			c[(c[a >> 2] | 0) + (f << 2) >> 2] = d;
			d = c[g >> 2] | 0;
			if (!d) return; else {
				i = g;
				k = f;
				f = g;
			}
			a: while (1) {
				e = d;
				d = f;
				b: while (1) {
					while (1) {
						f = c[e + 4 >> 2] | 0;
						if (m) j = f & l; else j = (f >>> 0) % (b >>> 0) | 0;
						if ((j | 0) == (k | 0)) {
							f = e;
							break;
						}
						f = (c[a >> 2] | 0) + (j << 2) | 0;
						if (!(c[f >> 2] | 0)) {
							h = j;
							break b;
						}
						h = e + 8 | 0;
						g = e;
						while (1) {
							f = c[g >> 2] | 0;
							if (!f) break;
							if ((c[h >> 2] | 0) == (c[f + 8 >> 2] | 0)) g = f; else break;
						}
						c[i >> 2] = f;
						c[g >> 2] = c[c[(c[a >> 2] | 0) + (j << 2) >> 2] >> 2];
						c[c[(c[a >> 2] | 0) + (j << 2) >> 2] >> 2] = e;
						e = c[i >> 2] | 0;
						if (!e) {
							d = 27;
							break a;
						}
					}
					e = c[f >> 2] | 0;
					if (!e) {
						d = 27;
						break a;
					} else {
						i = f;
						d = f;
					}
				}
				c[f >> 2] = d;
				d = c[e >> 2] | 0;
				if (!d) {
					d = 27;
					break;
				} else {
					i = e;
					k = h;
					f = e;
				}
			}
			if ((d | 0) == 27) return;
		}
		function Cf(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0, e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0, l = 0, m = 0;
			e = a + 4 | 0;
			if (!b) {
				d = c[a >> 2] | 0;
				c[a >> 2] = 0;
				if (d) cg(d);
				c[e >> 2] = 0;
				return;
			}
			m = bg(b << 2) | 0;
			d = c[a >> 2] | 0;
			c[a >> 2] = m;
			if (d) cg(d);
			c[e >> 2] = b;
			d = 0;
			do {
				c[(c[a >> 2] | 0) + (d << 2) >> 2] = 0;
				d = d + 1 | 0;
			} while ((d | 0) != (b | 0));
			d = a + 8 | 0;
			g = c[d >> 2] | 0;
			if (!g) return;
			e = c[g + 4 >> 2] | 0;
			l = b + -1 | 0;
			m = (l & b | 0) == 0;
			if (m) f = e & l; else f = (e >>> 0) % (b >>> 0) | 0;
			c[(c[a >> 2] | 0) + (f << 2) >> 2] = d;
			d = c[g >> 2] | 0;
			if (!d) return; else {
				i = g;
				k = f;
				f = g;
			}
			a: while (1) {
				e = d;
				d = f;
				b: while (1) {
					while (1) {
						f = c[e + 4 >> 2] | 0;
						if (m) j = f & l; else j = (f >>> 0) % (b >>> 0) | 0;
						if ((j | 0) == (k | 0)) {
							f = e;
							break;
						}
						f = (c[a >> 2] | 0) + (j << 2) | 0;
						if (!(c[f >> 2] | 0)) {
							h = j;
							break b;
						}
						h = e + 8 | 0;
						g = e;
						while (1) {
							f = c[g >> 2] | 0;
							if (!f) break;
							if ((c[h >> 2] | 0) == (c[f + 8 >> 2] | 0)) g = f; else break;
						}
						c[i >> 2] = f;
						c[g >> 2] = c[c[(c[a >> 2] | 0) + (j << 2) >> 2] >> 2];
						c[c[(c[a >> 2] | 0) + (j << 2) >> 2] >> 2] = e;
						e = c[i >> 2] | 0;
						if (!e) {
							d = 27;
							break a;
						}
					}
					e = c[f >> 2] | 0;
					if (!e) {
						d = 27;
						break a;
					} else {
						i = f;
						d = f;
					}
				}
				c[f >> 2] = d;
				d = c[e >> 2] | 0;
				if (!d) {
					d = 27;
					break;
				} else {
					i = e;
					k = h;
					f = e;
				}
			}
			if ((d | 0) == 27) return;
		}
		function Df(a, b, d, e, f) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			var g = 0, i = 0, j = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0, v = 0, w = 0, x = 0, y = 0, z = 0;
			a = d + 8 | 0;
			if ((jf(d, a, e) | 0) != -1) {
				g = ((c[d + 24 >> 2] | 0) >>> 4 & 2) + -1 | 0;
				return g | 0;
			}
			n = c[e >> 2] | 0;
			m = c[b >> 2] | 0;
			r = +(n | 0) - +(m | 0);
			l = c[e + 4 >> 2] | 0;
			g = c[b + 4 >> 2] | 0;
			q = +(l | 0) - +(g | 0);
			j = c[a >> 2] | 0;
			a = c[d >> 2] | 0;
			o = +(j | 0) - +(a | 0);
			e = c[d + 12 >> 2] | 0;
			b = c[d + 4 >> 2] | 0;
			p = +(e | 0) - +(b | 0);
			if ((a | 0) == (j | 0)) if ((l | 0) >= (g | 0) | f) return ((l | 0) > (g | 0) & f) << 31 >> 31 | 0; else {
				g = 1;
				return g | 0;
			}
			y = Xg(j | 0, ((j | 0) < 0) << 31 >> 31 | 0, a | 0, ((a | 0) < 0) << 31 >> 31 | 0) | 0;
			x = D;
			u = Xg(e | 0, ((e | 0) < 0) << 31 >> 31 | 0, b | 0, ((b | 0) < 0) << 31 >> 31 | 0) | 0;
			t = D;
			s = Xg(n | 0, ((n | 0) < 0) << 31 >> 31 | 0, m | 0, ((m | 0) < 0) << 31 >> 31 | 0) | 0;
			b = D;
			e = Xg(l | 0, ((l | 0) < 0) << 31 >> 31 | 0, g | 0, ((g | 0) < 0) << 31 >> 31 | 0) | 0;
			a = D;
			l = (x | 0) < 0;
			z = Xg(0, 0, y | 0, x | 0) | 0;
			x = l ? D : x;
			j = (t | 0) < 0;
			v = Xg(0, 0, u | 0, t | 0) | 0;
			t = j ? D : t;
			n = (b | 0) < 0;
			g = Xg(0, 0, s | 0, b | 0) | 0;
			b = n ? D : b;
			m = (a | 0) < 0;
			w = Xg(0, 0, e | 0, a | 0) | 0;
			a = ih((l ? z : y) | 0, x | 0, (m ? w : e) | 0, (m ? D : a) | 0) | 0;
			e = D;
			b = ih((j ? v : u) | 0, t | 0, (n ? g : s) | 0, b | 0) | 0;
			g = D;
			j = n ^ j;
			do if (m ^ l) {
				if (!j) {
					n = $g(b | 0, g | 0, a | 0, e | 0) | 0;
					i = -(+(n >>> 0) + 4294967296 * +(D >>> 0));
					break;
				}
				if (e >>> 0 > g >>> 0 | (e | 0) == (g | 0) & a >>> 0 > b >>> 0) {
					n = Xg(a | 0, e | 0, b | 0, g | 0) | 0;
					i = -(+(n >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					n = Xg(b | 0, g | 0, a | 0, e | 0) | 0;
					i = +(n >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} else {
				if (j) {
					n = $g(b | 0, g | 0, a | 0, e | 0) | 0;
					i = +(n >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
				if (e >>> 0 < g >>> 0 | (e | 0) == (g | 0) & a >>> 0 < b >>> 0) {
					n = Xg(b | 0, g | 0, a | 0, e | 0) | 0;
					i = -(+(n >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					n = Xg(a | 0, e | 0, b | 0, g | 0) | 0;
					i = +(n >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} while (0);
			if (!(i <= 0)) if (!(c[d + 24 >> 2] & 32)) {
				n = f << 31 >> 31;
				return n | 0;
			} else {
				n = f & 1 ^ 1;
				return n | 0;
			}
			h[k >> 3] = (q - r) * ((r + q) * o);
			g = c[k >> 2] | 0;
			b = c[k + 4 >> 2] | 0;
			h[k >> 3] = q * (r * (p * 2));
			e = c[k >> 2] | 0;
			a = c[k + 4 >> 2] | 0;
			n = (b | 0) > -1 | (b | 0) == -1 & g >>> 0 > 4294967295;
			m = Xg(0, -2147483648, g | 0, b | 0) | 0;
			g = n ? m : g;
			b = n ? D : b;
			n = (a | 0) > -1 | (a | 0) == -1 & e >>> 0 > 4294967295;
			m = Xg(0, -2147483648, e | 0, a | 0) | 0;
			e = n ? m : e;
			a = n ? D : a;
			if (b >>> 0 > a >>> 0 | (b | 0) == (a | 0) & g >>> 0 > e >>> 0) {
				g = Xg(g | 0, b | 0, e | 0, a | 0) | 0;
				n = D;
				g = (n >>> 0 > 0 | (n | 0) == 0 & g >>> 0 > 4) << 31 >> 31;
			} else {
				g = Xg(e | 0, a | 0, g | 0, b | 0) | 0;
				n = D;
				g = (n >>> 0 > 0 | (n | 0) == 0 & g >>> 0 > 4) & 1;
			}
			if (!((g | 0) != 0 & ((g | 0) == 1 ^ f))) {
				n = 0;
				return n | 0;
			}
			n = f ? -1 : 1;
			return n | 0;
		}
		function Ef(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0;
			h = c[b >> 2] | 0;
			f = c[b + 8 >> 2] | 0;
			if ((h | 0) == (f | 0)) {
				e = (+(h | 0) - +(c[d >> 2] | 0)) * .5;
				return +e;
			}
			i = +(f | 0) - +(h | 0);
			g = c[b + 12 >> 2] | 0;
			b = c[b + 4 >> 2] | 0;
			e = +(g | 0) - +(b | 0);
			i = i * i;
			j = +P(+(i + e * e));
			if (e < 0) j = (j - e) / i; else j = 1 / (j + e);
			o = ((h | 0) < 0) << 31 >> 31;
			f = Xg(f | 0, ((f | 0) < 0) << 31 >> 31 | 0, h | 0, o | 0) | 0;
			a = D;
			s = ((b | 0) < 0) << 31 >> 31;
			m = Xg(g | 0, ((g | 0) < 0) << 31 >> 31 | 0, b | 0, s | 0) | 0;
			g = D;
			n = c[d >> 2] | 0;
			o = Xg(n | 0, ((n | 0) < 0) << 31 >> 31 | 0, h | 0, o | 0) | 0;
			n = D;
			r = c[d + 4 >> 2] | 0;
			s = Xg(r | 0, ((r | 0) < 0) << 31 >> 31 | 0, b | 0, s | 0) | 0;
			r = D;
			k = (a | 0) < 0;
			q = Xg(0, 0, f | 0, a | 0) | 0;
			a = k ? D : a;
			l = (g | 0) < 0;
			h = Xg(0, 0, m | 0, g | 0) | 0;
			g = l ? D : g;
			b = (n | 0) < 0;
			p = Xg(0, 0, o | 0, n | 0) | 0;
			n = b ? D : n;
			d = (r | 0) < 0;
			t = Xg(0, 0, s | 0, r | 0) | 0;
			a = ih((d ? t : s) | 0, (d ? D : r) | 0, (k ? q : f) | 0, a | 0) | 0;
			f = D;
			g = ih((b ? p : o) | 0, n | 0, (l ? h : m) | 0, g | 0) | 0;
			h = D;
			b = l ^ b;
			do if (k ^ d) {
				if (!b) {
					m = $g(a | 0, f | 0, g | 0, h | 0) | 0;
					e = -(+(m >>> 0) + 4294967296 * +(D >>> 0));
					break;
				}
				if (f >>> 0 > h >>> 0 | (f | 0) == (h | 0) & a >>> 0 > g >>> 0) {
					m = Xg(a | 0, f | 0, g | 0, h | 0) | 0;
					e = -(+(m >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					m = Xg(g | 0, h | 0, a | 0, f | 0) | 0;
					e = +(m >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} else {
				if (b) {
					m = $g(a | 0, f | 0, g | 0, h | 0) | 0;
					e = +(m >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
				if (f >>> 0 < h >>> 0 | (f | 0) == (h | 0) & a >>> 0 < g >>> 0) {
					m = Xg(g | 0, h | 0, a | 0, f | 0) | 0;
					e = -(+(m >>> 0) + 4294967296 * +(D >>> 0));
					break;
				} else {
					m = Xg(a | 0, f | 0, g | 0, h | 0) | 0;
					e = +(m >>> 0) + 4294967296 * +(D >>> 0);
					break;
				}
			} while (0);
			e = j * e;
			return +e;
		}
		function Ff(a, b, d, e, f, g, j, k) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			g = g | 0;
			j = j | 0;
			k = k | 0;
			var l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0, v = 0, w = 0, x = 0, y = 0, z = 0, A = 0, B = 0, C = 0, E = 0, F = 0, G = 0, H = 0, I = 0, J = 0, K = 0, L = 0, M = 0, N = 0, O = 0, Q = 0, R = 0, S = 0, T = 0, U = 0, V = 0, W = 0, X = 0, Y = 0, Z = 0, _ = 0, $ = 0, aa = 0, ba = 0, ca = 0, da = 0, ea = 0, fa = 0, ga = 0, ha = 0, ia = 0, ja = 0, ka = 0;
			ja = i;
			i = i + 9632 | 0;
			fa = ja + 8844 | 0;
			_ = ja + 8064 | 0;
			M = ja + 7544 | 0;
			N = ja + 7024 | 0;
			E = ja + 6760 | 0;
			A = ja + 6500 | 0;
			B = ja + 6240 | 0;
			ga = ja + 5980 | 0;
			G = ja + 5720 | 0;
			H = ja + 5460 | 0;
			ha = ja + 5200 | 0;
			I = ja + 4940 | 0;
			J = ja + 4680 | 0;
			ia = ja + 4420 | 0;
			K = ja + 4160 | 0;
			L = ja + 3900 | 0;
			aa = ja + 3640 | 0;
			Z = ja + 3380 | 0;
			Q = ja + 3120 | 0;
			R = ja + 2860 | 0;
			S = ja + 2600 | 0;
			T = ja + 2340 | 0;
			U = ja + 2080 | 0;
			V = ja + 1820 | 0;
			W = ja + 1560 | 0;
			X = ja + 1300 | 0;
			Y = ja + 1040 | 0;
			ba = ja + 780 | 0;
			$ = ja + 520 | 0;
			da = ja + 260 | 0;
			ea = ja;
			p = c[b >> 2] | 0;
			s = ((p | 0) < 0) << 31 >> 31;
			x = c[d >> 2] | 0;
			y = ((x | 0) < 0) << 31 >> 31;
			a = Xg(p | 0, s | 0, x | 0, y | 0) | 0;
			l = D;
			do if (!((l | 0) > 0 | (l | 0) == 0 & a >>> 0 > 0)) if ((l | 0) < 0) {
				t = Xg(0, 0, a | 0, l | 0) | 0;
				O = D;
				c[fa >> 2] = t;
				c[fa + 4 >> 2] = O;
				c[fa + 256 >> 2] = (O | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[fa + 256 >> 2] = 0;
				break;
			} else {
				c[fa >> 2] = a;
				c[fa + 4 >> 2] = l;
				c[fa + 256 >> 2] = (l | 0) != 0 ? 2 : 1;
			} while (0);
			ca = fa + 260 | 0;
			v = c[e >> 2] | 0;
			w = ((v | 0) < 0) << 31 >> 31;
			a = Xg(x | 0, y | 0, v | 0, w | 0) | 0;
			l = D;
			do if (!((l | 0) > 0 | (l | 0) == 0 & a >>> 0 > 0)) if ((l | 0) < 0) {
				t = Xg(0, 0, a | 0, l | 0) | 0;
				O = D;
				c[ca >> 2] = t;
				c[fa + 264 >> 2] = O;
				c[fa + 516 >> 2] = (O | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[fa + 516 >> 2] = 0;
				break;
			} else {
				c[ca >> 2] = a;
				c[fa + 264 >> 2] = l;
				c[fa + 516 >> 2] = (l | 0) != 0 ? 2 : 1;
			} while (0);
			O = fa + 520 | 0;
			a = Xg(p | 0, s | 0, v | 0, w | 0) | 0;
			l = D;
			do if (!((l | 0) > 0 | (l | 0) == 0 & a >>> 0 > 0)) if ((l | 0) < 0) {
				r = Xg(0, 0, a | 0, l | 0) | 0;
				t = D;
				c[O >> 2] = r;
				c[fa + 524 >> 2] = t;
				c[fa + 776 >> 2] = (t | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[fa + 776 >> 2] = 0;
				break;
			} else {
				c[O >> 2] = a;
				c[fa + 524 >> 2] = l;
				c[fa + 776 >> 2] = (l | 0) != 0 ? 2 : 1;
			} while (0);
			q = c[b + 4 >> 2] | 0;
			r = ((q | 0) < 0) << 31 >> 31;
			t = c[d + 4 >> 2] | 0;
			u = ((t | 0) < 0) << 31 >> 31;
			b = Xg(q | 0, r | 0, t | 0, u | 0) | 0;
			a = D;
			do if (!((a | 0) > 0 | (a | 0) == 0 & b >>> 0 > 0)) if ((a | 0) < 0) {
				b = Xg(0, 0, b | 0, a | 0) | 0;
				d = D;
				c[_ >> 2] = b;
				c[_ + 4 >> 2] = d;
				c[_ + 256 >> 2] = (d | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[_ + 256 >> 2] = 0;
				break;
			} else {
				c[_ >> 2] = b;
				c[_ + 4 >> 2] = a;
				c[_ + 256 >> 2] = (a | 0) != 0 ? 2 : 1;
			} while (0);
			F = _ + 260 | 0;
			e = c[e + 4 >> 2] | 0;
			d = ((e | 0) < 0) << 31 >> 31;
			b = Xg(t | 0, u | 0, e | 0, d | 0) | 0;
			a = D;
			do if (!((a | 0) > 0 | (a | 0) == 0 & b >>> 0 > 0)) if ((a | 0) < 0) {
				a = Xg(0, 0, b | 0, a | 0) | 0;
				b = D;
				c[F >> 2] = a;
				c[_ + 264 >> 2] = b;
				c[_ + 516 >> 2] = (b | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[_ + 516 >> 2] = 0;
				break;
			} else {
				c[F >> 2] = b;
				c[_ + 264 >> 2] = a;
				c[_ + 516 >> 2] = (a | 0) != 0 ? 2 : 1;
			} while (0);
			C = _ + 520 | 0;
			b = Xg(q | 0, r | 0, e | 0, d | 0) | 0;
			a = D;
			do if (!((a | 0) > 0 | (a | 0) == 0 & b >>> 0 > 0)) if ((a | 0) < 0) {
				a = Xg(0, 0, b | 0, a | 0) | 0;
				b = D;
				c[C >> 2] = a;
				c[_ + 524 >> 2] = b;
				c[_ + 776 >> 2] = (b | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[_ + 776 >> 2] = 0;
				break;
			} else {
				c[C >> 2] = b;
				c[_ + 524 >> 2] = a;
				c[_ + 776 >> 2] = (a | 0) != 0 ? 2 : 1;
			} while (0);
			b = $g(x | 0, y | 0, p | 0, s | 0) | 0;
			a = D;
			do if (!((a | 0) > 0 | (a | 0) == 0 & b >>> 0 > 0)) if ((a | 0) < 0) {
				b = Xg(0, 0, b | 0, a | 0) | 0;
				p = D;
				c[M >> 2] = b;
				c[M + 4 >> 2] = p;
				c[M + 256 >> 2] = (p | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[M + 256 >> 2] = 0;
				break;
			} else {
				c[M >> 2] = b;
				c[M + 4 >> 2] = a;
				c[M + 256 >> 2] = (a | 0) != 0 ? 2 : 1;
			} while (0);
			p = M + 260 | 0;
			a = $g(v | 0, w | 0, x | 0, y | 0) | 0;
			l = D;
			do if (!((l | 0) > 0 | (l | 0) == 0 & a >>> 0 > 0)) if ((l | 0) < 0) {
				a = Xg(0, 0, a | 0, l | 0) | 0;
				b = D;
				c[p >> 2] = a;
				c[M + 264 >> 2] = b;
				c[M + 516 >> 2] = (b | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[M + 516 >> 2] = 0;
				break;
			} else {
				c[p >> 2] = a;
				c[M + 264 >> 2] = l;
				c[M + 516 >> 2] = (l | 0) != 0 ? 2 : 1;
			} while (0);
			a = $g(t | 0, u | 0, q | 0, r | 0) | 0;
			l = D;
			do if (!((l | 0) > 0 | (l | 0) == 0 & a >>> 0 > 0)) if ((l | 0) < 0) {
				q = Xg(0, 0, a | 0, l | 0) | 0;
				r = D;
				c[N >> 2] = q;
				c[N + 4 >> 2] = r;
				c[N + 256 >> 2] = (r | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[N + 256 >> 2] = 0;
				break;
			} else {
				c[N >> 2] = a;
				c[N + 4 >> 2] = l;
				c[N + 256 >> 2] = (l | 0) != 0 ? 2 : 1;
			} while (0);
			b = N + 260 | 0;
			a = $g(e | 0, d | 0, t | 0, u | 0) | 0;
			l = D;
			do if (!((l | 0) > 0 | (l | 0) == 0 & a >>> 0 > 0)) if ((l | 0) < 0) {
				r = Xg(0, 0, a | 0, l | 0) | 0;
				t = D;
				c[b >> 2] = r;
				c[N + 264 >> 2] = t;
				c[N + 516 >> 2] = (t | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[N + 516 >> 2] = 0;
				break;
			} else {
				c[b >> 2] = a;
				c[N + 264 >> 2] = l;
				c[N + 516 >> 2] = (l | 0) != 0 ? 2 : 1;
			} while (0);
			Jf(A, fa, F);
			Jf(B, ca, _);
			Kf(E, A, B);
			l = c[E + 256 >> 2] | 0;
			a = (l | 0) > -1 ? l : 0 - l | 0;
			if (!a) {
				o = 0;
				a = 0;
			} else if ((a | 0) == 1) {
				o = +((c[E >> 2] | 0) >>> 0);
				a = 0;
				ka = 55;
			} else if ((a | 0) == 2) {
				o = +((c[E + 4 >> 2] | 0) >>> 0) * 4294967296 + +((c[E >> 2] | 0) >>> 0);
				a = 0;
				ka = 55;
			} else {
				o = +((c[E + (a + -3 << 2) >> 2] | 0) >>> 0) + (+((c[E + (a + -1 << 2) >> 2] | 0) >>> 0) * 4294967296 + +((c[E + (a + -2 << 2) >> 2] | 0) >>> 0)) * 4294967296;
				a = (a << 5) + -96 | 0;
				ka = 55;
			}
			if ((ka | 0) == 55) if ((l | 0) < 0) o = -o;
			z = .5 / +Yf(o, a);
			Jf(G, fa, M);
			Jf(H, _, N);
			Lf(ga, G, H);
			Jf(I, ca, p);
			Jf(J, F, b);
			Lf(ha, I, J);
			if (g | k) {
				Jf(K, ga, F);
				Jf(L, ha, _);
				Kf(ia, K, L);
				b = ia + 256 | 0;
				l = c[b >> 2] | 0;
				a = (l | 0) > -1 ? l : 0 - l | 0;
				if ((a | 0) == 1) {
					o = +((c[ia >> 2] | 0) >>> 0);
					a = 0;
					ka = 62;
				} else if ((a | 0) == 2) {
					o = +((c[ia + 4 >> 2] | 0) >>> 0) * 4294967296 + +((c[ia >> 2] | 0) >>> 0);
					a = 0;
					ka = 62;
				} else if (!a) {
					o = 0;
					a = 0;
				} else {
					o = +((c[ia + (a + -3 << 2) >> 2] | 0) >>> 0) + (+((c[ia + (a + -1 << 2) >> 2] | 0) >>> 0) * 4294967296 + +((c[ia + (a + -2 << 2) >> 2] | 0) >>> 0)) * 4294967296;
					a = (a << 5) + -96 | 0;
					ka = 62;
				}
				if ((ka | 0) == 62) if ((l | 0) < 0) o = -o;
				h[f >> 3] = z * +Yf(o, a);
				if (k) {
					Jf(Z, fa, fa);
					Jf(Q, _, _);
					Lf(R, Z, Q);
					Jf(T, ca, ca);
					Jf(U, F, F);
					Lf(S, T, U);
					Jf(V, R, S);
					Jf(X, O, O);
					Jf(Y, C, C);
					Lf(W, X, Y);
					Jf(aa, V, W);
					l = c[aa + 256 >> 2] | 0;
					a = (l | 0) > -1 ? l : 0 - l | 0;
					if ((a | 0) == 1) {
						m = +((c[aa >> 2] | 0) >>> 0);
						a = 0;
						ka = 69;
					} else if ((a | 0) == 2) {
						m = +((c[aa + 4 >> 2] | 0) >>> 0) * 4294967296 + +((c[aa >> 2] | 0) >>> 0);
						a = 0;
						ka = 69;
					} else if (!a) {
						m = 0;
						a = 0;
					} else {
						m = +((c[aa + (a + -3 << 2) >> 2] | 0) >>> 0) + (+((c[aa + (a + -1 << 2) >> 2] | 0) >>> 0) * 4294967296 + +((c[aa + (a + -2 << 2) >> 2] | 0) >>> 0)) * 4294967296;
						a = (a << 5) + -96 | 0;
						ka = 69;
					}
					if ((ka | 0) == 69) if ((l | 0) < 0) m = -m;
					o = +P(+ +Yf(m, a));
					n = +h[f >> 3];
					do if (!(n < 0)) {
						m = z * o;
						if (z < 0) {
							h[f + 16 >> 3] = n - m;
							break;
						} else {
							h[f + 16 >> 3] = n + m;
							break;
						}
					} else {
						Jf($, ia, ia);
						Kf(ba, $, aa);
						l = c[ba + 256 >> 2] | 0;
						a = (l | 0) > -1 ? l : 0 - l | 0;
						if (!a) {
							m = 0;
							a = 0;
						} else if ((a | 0) == 1) {
							m = +((c[ba >> 2] | 0) >>> 0);
							a = 0;
							ka = 79;
						} else if ((a | 0) == 2) {
							m = +((c[ba + 4 >> 2] | 0) >>> 0) * 4294967296 + +((c[ba >> 2] | 0) >>> 0);
							a = 0;
							ka = 79;
						} else {
							m = +((c[ba + (a + -3 << 2) >> 2] | 0) >>> 0) + (+((c[ba + (a + -1 << 2) >> 2] | 0) >>> 0) * 4294967296 + +((c[ba + (a + -2 << 2) >> 2] | 0) >>> 0)) * 4294967296;
							a = (a << 5) + -96 | 0;
							ka = 79;
						}
						if ((ka | 0) == 79) if ((l | 0) < 0) m = -m;
						n = z * +Yf(m, a);
						l = c[b >> 2] | 0;
						a = (l | 0) > -1 ? l : 0 - l | 0;
						if ((a | 0) == 1) {
							m = +((c[ia >> 2] | 0) >>> 0);
							a = 0;
							ka = 85;
						} else if ((a | 0) == 2) {
							m = +((c[ia + 4 >> 2] | 0) >>> 0) * 4294967296 + +((c[ia >> 2] | 0) >>> 0);
							a = 0;
							ka = 85;
						} else if (!a) {
							m = 0;
							a = 0;
						} else {
							m = +((c[ia + (a + -3 << 2) >> 2] | 0) >>> 0) + (+((c[ia + (a + -1 << 2) >> 2] | 0) >>> 0) * 4294967296 + +((c[ia + (a + -2 << 2) >> 2] | 0) >>> 0)) * 4294967296;
							a = (a << 5) + -96 | 0;
							ka = 85;
						}
						if ((ka | 0) == 85) if ((l | 0) < 0) m = -m;
						h[f + 16 >> 3] = n / (o + +Yf(m, a));
					} while (0);
				}
			}
			if (!j) {
				i = ja;
				return;
			}
			Jf(da, ha, fa);
			Jf(ea, ga, ca);
			Kf(ia, da, ea);
			a = c[ia + 256 >> 2] | 0;
			l = (a | 0) > -1 ? a : 0 - a | 0;
			if ((l | 0) == 2) {
				m = +((c[ia + 4 >> 2] | 0) >>> 0) * 4294967296 + +((c[ia >> 2] | 0) >>> 0);
				l = 0;
				ka = 95;
			} else if (!l) {
				m = 0;
				l = 0;
			} else if ((l | 0) == 1) {
				m = +((c[ia >> 2] | 0) >>> 0);
				l = 0;
				ka = 95;
			} else {
				m = +((c[ia + (l + -3 << 2) >> 2] | 0) >>> 0) + (+((c[ia + (l + -1 << 2) >> 2] | 0) >>> 0) * 4294967296 + +((c[ia + (l + -2 << 2) >> 2] | 0) >>> 0)) * 4294967296;
				l = (l << 5) + -96 | 0;
				ka = 95;
			}
			if ((ka | 0) == 95) if ((a | 0) < 0) m = -m;
			h[f + 8 >> 3] = z * +Yf(m, l);
			i = ja;
			return;
		}
		function Gf(a, b, d, e, f, g, j, k, l) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			g = g | 0;
			j = j | 0;
			k = k | 0;
			l = l | 0;
			var m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0, v = 0, w = 0, x = 0, y = 0, z = 0, A = 0, B = 0, C = 0, E = 0, F = 0, G = 0, H = 0, I = 0, J = 0, K = 0, L = 0, M = 0, N = 0, O = 0, Q = 0, R = 0, S = 0, T = 0, U = 0, V = 0, W = 0, X = 0, Y = 0, Z = 0, _ = 0, $ = 0, aa = 0, ba = 0, ca = 0, da = 0, ea = 0, fa = 0, ga = 0, ha = 0, ia = 0, ja = 0, ka = 0, la = 0, ma = 0, na = 0, oa = 0, pa = 0, qa = 0, ra = 0, sa = 0, ta = 0, ua = 0, va = 0, wa = 0, xa = 0, ya = 0, za = 0, Aa = 0, Ba = 0, Ca = 0, Da = 0, Ea = 0, Fa = 0, Ga = 0, Ha = 0, Ia = 0, Ja = 0, Ka = 0, La = 0, Ma = 0, Na = 0, Oa = 0, Pa = 0, Qa = 0, Ra = 0, Sa = 0, Ta = 0, Ua = 0;
			Ua = i;
			i = i + 18272 | 0;
			la = Ua + 18008 | 0;
			Qa = Ua + 16968 | 0;
			Ra = Ua + 15928 | 0;
			O = Ua + 15664 | 0;
			Q = Ua + 15404 | 0;
			Sa = Ua + 15144 | 0;
			q = Ua + 14884 | 0;
			r = Ua + 14624 | 0;
			Ka = Ua + 14364 | 0;
			Na = Ua + 14104 | 0;
			Ia = Ua + 13844 | 0;
			Ma = Ua + 13584 | 0;
			Ja = Ua + 13324 | 0;
			z = Ua + 13064 | 0;
			A = Ua + 12804 | 0;
			Oa = Ua + 12544 | 0;
			B = Ua + 12284 | 0;
			C = Ua + 12024 | 0;
			M = Ua + 11764 | 0;
			N = Ua + 11504 | 0;
			fa = Ua + 11244 | 0;
			G = Ua + 10984 | 0;
			H = Ua + 10724 | 0;
			ga = Ua + 10464 | 0;
			K = Ua + 10204 | 0;
			L = Ua + 9944 | 0;
			Ha = Ua + 9684 | 0;
			La = Ua + 9424 | 0;
			R = Ua + 9164 | 0;
			S = Ua + 8904 | 0;
			T = Ua + 8644 | 0;
			U = Ua + 8384 | 0;
			V = Ua + 8124 | 0;
			W = Ua + 7864 | 0;
			X = Ua + 7604 | 0;
			Y = Ua + 7344 | 0;
			Z = Ua + 7084 | 0;
			_ = Ua + 6824 | 0;
			$ = Ua + 6564 | 0;
			ha = Ua + 6304 | 0;
			ia = Ua + 6044 | 0;
			ja = Ua + 5784 | 0;
			ka = Ua + 5524 | 0;
			Pa = Ua + 48 | 0;
			aa = Ua + 5264 | 0;
			ba = Ua + 5004 | 0;
			ca = Ua + 4744 | 0;
			da = Ua + 4484 | 0;
			ea = Ua + 4224 | 0;
			ma = Ua + 3964 | 0;
			na = Ua + 3704 | 0;
			oa = Ua + 3444 | 0;
			pa = Ua + 3184 | 0;
			qa = Ua + 2924 | 0;
			ra = Ua + 32 | 0;
			sa = Ua + 2664 | 0;
			ta = Ua + 2404 | 0;
			ua = Ua + 2144 | 0;
			va = Ua + 1884 | 0;
			wa = Ua + 1624 | 0;
			xa = Ua + 16 | 0;
			ya = Ua + 1364 | 0;
			za = Ua + 1104 | 0;
			Aa = Ua + 844 | 0;
			Ba = Ua + 584 | 0;
			Ca = Ua + 324 | 0;
			Da = Ua + 64 | 0;
			Ea = Ua;
			F = e + 12 | 0;
			n = c[F >> 2] | 0;
			p = c[e + 4 >> 2] | 0;
			p = Xg(n | 0, ((n | 0) < 0) << 31 >> 31 | 0, p | 0, ((p | 0) < 0) << 31 >> 31 | 0) | 0;
			n = D;
			do if (!((n | 0) > 0 | (n | 0) == 0 & p >>> 0 > 0)) if ((n | 0) < 0) {
				v = Xg(0, 0, p | 0, n | 0) | 0;
				J = D;
				c[O >> 2] = v;
				c[O + 4 >> 2] = J;
				c[O + 256 >> 2] = (J | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[O + 256 >> 2] = 0;
				break;
			} else {
				c[O >> 2] = p;
				c[O + 4 >> 2] = n;
				c[O + 256 >> 2] = (n | 0) != 0 ? 2 : 1;
			} while (0);
			n = c[e >> 2] | 0;
			E = e + 8 | 0;
			p = c[E >> 2] | 0;
			p = Xg(n | 0, ((n | 0) < 0) << 31 >> 31 | 0, p | 0, ((p | 0) < 0) << 31 >> 31 | 0) | 0;
			n = D;
			do if (!((n | 0) > 0 | (n | 0) == 0 & p >>> 0 > 0)) if ((n | 0) < 0) {
				v = Xg(0, 0, p | 0, n | 0) | 0;
				J = D;
				c[Q >> 2] = v;
				c[Q + 4 >> 2] = J;
				c[Q + 256 >> 2] = (J | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[Q + 256 >> 2] = 0;
				break;
			} else {
				c[Q >> 2] = p;
				c[Q + 4 >> 2] = n;
				c[Q + 256 >> 2] = (n | 0) != 0 ? 2 : 1;
			} while (0);
			Jf(q, O, O);
			Jf(r, Q, Q);
			Lf(Sa, q, r);
			y = d + 4 | 0;
			t = c[y >> 2] | 0;
			u = ((t | 0) < 0) << 31 >> 31;
			x = b + 4 | 0;
			v = c[x >> 2] | 0;
			w = ((v | 0) < 0) << 31 >> 31;
			r = Xg(t | 0, u | 0, v | 0, w | 0) | 0;
			q = D;
			do if (!((q | 0) > 0 | (q | 0) == 0 & r >>> 0 > 0)) if ((q | 0) < 0) {
				s = Xg(0, 0, r | 0, q | 0) | 0;
				J = D;
				c[Ka >> 2] = s;
				c[Ka + 4 >> 2] = J;
				J = (J | 0) != 0 ? -2 : -1;
				c[Ka + 256 >> 2] = J;
				break;
			} else {
				c[Ka + 256 >> 2] = 0;
				J = 0;
				break;
			} else {
				c[Ka >> 2] = r;
				c[Ka + 4 >> 2] = q;
				J = (q | 0) != 0 ? 2 : 1;
				c[Ka + 256 >> 2] = J;
			} while (0);
			p = c[b >> 2] | 0;
			n = ((p | 0) < 0) << 31 >> 31;
			e = c[d >> 2] | 0;
			s = ((e | 0) < 0) << 31 >> 31;
			r = Xg(p | 0, n | 0, e | 0, s | 0) | 0;
			q = D;
			do if (!((q | 0) > 0 | (q | 0) == 0 & r >>> 0 > 0)) if ((q | 0) < 0) {
				r = Xg(0, 0, r | 0, q | 0) | 0;
				I = D;
				c[Na >> 2] = r;
				c[Na + 4 >> 2] = I;
				I = (I | 0) != 0 ? -2 : -1;
				c[Na + 256 >> 2] = I;
				break;
			} else {
				c[Na + 256 >> 2] = 0;
				I = 0;
				break;
			} else {
				c[Na >> 2] = r;
				c[Na + 4 >> 2] = q;
				I = (q | 0) != 0 ? 2 : 1;
				c[Na + 256 >> 2] = I;
			} while (0);
			r = $g(e | 0, s | 0, p | 0, n | 0) | 0;
			q = D;
			do if (!((q | 0) > 0 | (q | 0) == 0 & r >>> 0 > 0)) if ((q | 0) < 0) {
				r = Xg(0, 0, r | 0, q | 0) | 0;
				s = D;
				c[Ia >> 2] = r;
				c[Ia + 4 >> 2] = s;
				c[Ia + 256 >> 2] = (s | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[Ia + 256 >> 2] = 0;
				break;
			} else {
				c[Ia >> 2] = r;
				c[Ia + 4 >> 2] = q;
				c[Ia + 256 >> 2] = (q | 0) != 0 ? 2 : 1;
			} while (0);
			p = $g(t | 0, u | 0, v | 0, w | 0) | 0;
			n = D;
			do if (!((n | 0) > 0 | (n | 0) == 0 & p >>> 0 > 0)) if ((n | 0) < 0) {
				u = Xg(0, 0, p | 0, n | 0) | 0;
				v = D;
				c[Ma >> 2] = u;
				c[Ma + 4 >> 2] = v;
				c[Ma + 256 >> 2] = (v | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[Ma + 256 >> 2] = 0;
				break;
			} else {
				c[Ma >> 2] = p;
				c[Ma + 4 >> 2] = n;
				c[Ma + 256 >> 2] = (n | 0) != 0 ? 2 : 1;
			} while (0);
			Jf(z, O, Ka);
			Jf(A, Q, Na);
			Lf(Ja, z, A);
			Jf(B, Ka, Q);
			Jf(C, Na, O);
			Kf(Oa, B, C);
			n = c[F >> 2] | 0;
			p = c[x >> 2] | 0;
			p = Xg(n | 0, ((n | 0) < 0) << 31 >> 31 | 0, p | 0, ((p | 0) < 0) << 31 >> 31 | 0) | 0;
			n = D;
			do if (!((n | 0) > 0 | (n | 0) == 0 & p >>> 0 > 0)) if ((n | 0) < 0) {
				u = Xg(0, 0, p | 0, n | 0) | 0;
				v = D;
				c[M >> 2] = u;
				c[M + 4 >> 2] = v;
				c[M + 256 >> 2] = (v | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[M + 256 >> 2] = 0;
				break;
			} else {
				c[M >> 2] = p;
				c[M + 4 >> 2] = n;
				c[M + 256 >> 2] = (n | 0) != 0 ? 2 : 1;
			} while (0);
			n = c[b >> 2] | 0;
			p = c[E >> 2] | 0;
			p = Xg(n | 0, ((n | 0) < 0) << 31 >> 31 | 0, p | 0, ((p | 0) < 0) << 31 >> 31 | 0) | 0;
			n = D;
			do if (!((n | 0) > 0 | (n | 0) == 0 & p >>> 0 > 0)) if ((n | 0) < 0) {
				u = Xg(0, 0, p | 0, n | 0) | 0;
				v = D;
				c[N >> 2] = u;
				c[N + 4 >> 2] = v;
				c[N + 256 >> 2] = (v | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[N + 256 >> 2] = 0;
				break;
			} else {
				c[N >> 2] = p;
				c[N + 4 >> 2] = n;
				c[N + 256 >> 2] = (n | 0) != 0 ? 2 : 1;
			} while (0);
			Jf(G, O, N);
			Jf(H, Q, M);
			Kf(fa, G, H);
			n = c[F >> 2] | 0;
			p = c[y >> 2] | 0;
			p = Xg(n | 0, ((n | 0) < 0) << 31 >> 31 | 0, p | 0, ((p | 0) < 0) << 31 >> 31 | 0) | 0;
			n = D;
			do if (!((n | 0) > 0 | (n | 0) == 0 & p >>> 0 > 0)) if ((n | 0) < 0) {
				u = Xg(0, 0, p | 0, n | 0) | 0;
				v = D;
				c[M >> 2] = u;
				c[M + 4 >> 2] = v;
				c[M + 256 >> 2] = (v | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[M + 256 >> 2] = 0;
				break;
			} else {
				c[M >> 2] = p;
				c[M + 4 >> 2] = n;
				c[M + 256 >> 2] = (n | 0) != 0 ? 2 : 1;
			} while (0);
			n = c[d >> 2] | 0;
			p = c[E >> 2] | 0;
			p = Xg(n | 0, ((n | 0) < 0) << 31 >> 31 | 0, p | 0, ((p | 0) < 0) << 31 >> 31 | 0) | 0;
			n = D;
			do if (!((n | 0) > 0 | (n | 0) == 0 & p >>> 0 > 0)) if ((n | 0) < 0) {
				v = Xg(0, 0, p | 0, n | 0) | 0;
				d = D;
				c[N >> 2] = v;
				c[N + 4 >> 2] = d;
				c[N + 256 >> 2] = (d | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[N + 256 >> 2] = 0;
				break;
			} else {
				c[N >> 2] = p;
				c[N + 4 >> 2] = n;
				c[N + 256 >> 2] = (n | 0) != 0 ? 2 : 1;
			} while (0);
			Jf(K, O, N);
			Jf(L, Q, M);
			Kf(ga, K, L);
			Lf(Ha, fa, ga);
			n = Oa + 256 | 0;
			if (c[n >> 2] | 0) {
				Jf(aa, Ja, Ja);
				Jf(ba, Oa, Oa);
				Lf(ca, aa, ba);
				Jf(da, ca, fa);
				Jf(ea, da, ga);
				c[la >> 2] = 4;
				c[la + 256 >> 2] = 1;
				Jf(La, ea, la);
				n = c[n >> 2] | 0;
				p = (n | 0) > -1 ? n : 0 - n | 0;
				if ((p | 0) == 1) {
					o = +((c[Oa >> 2] | 0) >>> 0);
					p = 0;
					Ta = 87;
				} else if ((p | 0) == 2) {
					o = +((c[Oa + 4 >> 2] | 0) >>> 0) * 4294967296 + +((c[Oa >> 2] | 0) >>> 0);
					p = 0;
					Ta = 87;
				} else if (!p) {
					o = 0;
					p = 0;
				} else {
					o = +((c[Oa + (p + -3 << 2) >> 2] | 0) >>> 0) + (+((c[Oa + (p + -1 << 2) >> 2] | 0) >>> 0) * 4294967296 + +((c[Oa + (p + -2 << 2) >> 2] | 0) >>> 0)) * 4294967296;
					p = (p << 5) + -96 | 0;
					Ta = 87;
				}
				if ((Ta | 0) == 87) if ((n | 0) < 0) o = -o;
				o = 1 / +Yf(o, p);
				o = o * o;
				if (j | l ? (Jf(na, Ia, Oa), Jf(oa, na, Oa), Jf(qa, Ja, Ha), Jf(pa, qa, Ka), Lf(ma, oa, pa),
					bh(Qa | 0, ma | 0, 260) | 0, c[Ra >> 2] = 1, c[Ra + 256 >> 2] = 1, bh(Qa + 260 | 0, Ka | 0, 256) | 0,
					c[Qa + 516 >> 2] = (f | 0) == 2 ? 0 - J | 0 : J, bh(Ra + 260 | 0, La | 0, 260) | 0,
					j) : 0) {
					Mf(ra, a, Qa, Ra);
					h[g >> 3] = o * (+Yf(+h[ra >> 3], c[ra + 8 >> 2] | 0) * .5);
				}
				if (k | l ? (Fa = Qa + 520 | 0, Jf(ta, Ma, Oa), Jf(ua, ta, Oa), Jf(wa, Ja, Ha),
					Jf(va, wa, Na), Lf(sa, ua, va), bh(Fa | 0, sa | 0, 260) | 0, Ga = Ra + 520 | 0,
					c[Ga >> 2] = 1, c[Ra + 776 >> 2] = 1, bh(Qa + 780 | 0, Na | 0, 256) | 0, c[Qa + 1036 >> 2] = (f | 0) == 2 ? 0 - I | 0 : I,
					bh(Ra + 780 | 0, La | 0, 260) | 0, k) : 0) {
					Mf(xa, a, Fa, Ga);
					h[g + 8 >> 3] = o * (+Yf(+h[xa >> 3], c[xa + 8 >> 2] | 0) * .5);
				}
				if (l) {
					Jf(ya, Ra, Sa);
					bh(Ra | 0, ya | 0, 260) | 0;
					n = Ra + 260 | 0;
					Jf(za, n, Sa);
					bh(n | 0, za | 0, 260) | 0;
					Jf(Ca, Oa, Oa);
					Jf(Da, Ja, Ja);
					Lf(Ba, Ca, Da);
					Jf(Aa, Ha, Ba);
					bh(Qa + 520 | 0, Aa | 0, 260) | 0;
					c[Ra + 520 >> 2] = 1;
					c[Ra + 776 >> 2] = 1;
					n = c[Ja + 256 >> 2] | 0;
					bh(Qa + 780 | 0, Ja | 0, 256) | 0;
					c[Qa + 1036 >> 2] = (f | 0) == 2 ? 0 - n | 0 : n;
					bh(Ra + 780 | 0, La | 0, 260) | 0;
					Nf(Ea, a, Qa, Ra);
					o = o * (+Yf(+h[Ea >> 3], c[Ea + 8 >> 2] | 0) * .5);
					n = c[Sa + 256 >> 2] | 0;
					e = (n | 0) > -1 ? n : 0 - n | 0;
					if (!e) {
						m = 0;
						e = 0;
					} else if ((e | 0) == 1) {
						m = +((c[Sa >> 2] | 0) >>> 0);
						e = 0;
						Ta = 100;
					} else if ((e | 0) == 2) {
						m = +((c[Sa + 4 >> 2] | 0) >>> 0) * 4294967296 + +((c[Sa >> 2] | 0) >>> 0);
						e = 0;
						Ta = 100;
					} else {
						m = +((c[Sa + (e + -3 << 2) >> 2] | 0) >>> 0) + (+((c[Sa + (e + -1 << 2) >> 2] | 0) >>> 0) * 4294967296 + +((c[Sa + (e + -2 << 2) >> 2] | 0) >>> 0)) * 4294967296;
						e = (e << 5) + -96 | 0;
						Ta = 100;
					}
					if ((Ta | 0) == 100) if ((n | 0) < 0) m = -m;
					h[g + 16 >> 3] = o / +P(+ +Yf(m, e));
				}
				i = Ua;
				return;
			}
			Jf(R, Ja, Ja);
			Jf(S, Ha, Ha);
			Kf(La, R, S);
			Jf(T, Ja, Ha);
			bh(Oa | 0, T | 0, 260) | 0;
			Jf(V, Oa, Ia);
			c[la >> 2] = 2;
			c[la + 256 >> 2] = 1;
			Jf(W, V, la);
			Jf(X, La, Ka);
			Lf(U, W, X);
			bh(Qa | 0, U | 0, 260) | 0;
			bh(Ra | 0, Sa | 0, 260) | 0;
			Jf(Z, Oa, Ha);
			c[la >> 2] = 2;
			c[la + 256 >> 2] = 1;
			Jf(_, Z, la);
			Jf($, La, Ja);
			Lf(Y, _, $);
			bh(Qa + 260 | 0, Y | 0, 260) | 0;
			c[Ra + 260 >> 2] = 1;
			c[Ra + 516 >> 2] = 1;
			p = Qa + 520 | 0;
			Jf(ia, Oa, Ma);
			c[la >> 2] = 2;
			c[la + 256 >> 2] = 1;
			Jf(ja, ia, la);
			Jf(ka, La, Na);
			Lf(ha, ja, ka);
			bh(p | 0, ha | 0, 260) | 0;
			e = c[n >> 2] | 0;
			n = (e | 0) > -1 ? e : 0 - e | 0;
			if (!n) {
				o = 0;
				n = 0;
			} else if ((n | 0) == 1) {
				o = +((c[Oa >> 2] | 0) >>> 0);
				n = 0;
				Ta = 56;
			} else if ((n | 0) == 2) {
				o = +((c[Oa + 4 >> 2] | 0) >>> 0) * 4294967296 + +((c[Oa >> 2] | 0) >>> 0);
				n = 0;
				Ta = 56;
			} else {
				o = +((c[Oa + (n + -3 << 2) >> 2] | 0) >>> 0) + (+((c[Oa + (n + -1 << 2) >> 2] | 0) >>> 0) * 4294967296 + +((c[Oa + (n + -2 << 2) >> 2] | 0) >>> 0)) * 4294967296;
				n = (n << 5) + -96 | 0;
				Ta = 56;
			}
			if ((Ta | 0) == 56) if ((e | 0) < 0) o = -o;
			m = 1 / +Yf(o, n);
			if (j) {
				e = c[Qa + 256 >> 2] | 0;
				n = (e | 0) > -1 ? e : 0 - e | 0;
				if ((n | 0) == 1) {
					o = +((c[Qa >> 2] | 0) >>> 0);
					n = 0;
					Ta = 63;
				} else if ((n | 0) == 2) {
					o = +((c[Qa + 4 >> 2] | 0) >>> 0) * 4294967296 + +((c[Qa >> 2] | 0) >>> 0);
					n = 0;
					Ta = 63;
				} else if (!n) {
					o = 0;
					n = 0;
				} else {
					o = +((c[Qa + (n + -3 << 2) >> 2] | 0) >>> 0) + (+((c[Qa + (n + -1 << 2) >> 2] | 0) >>> 0) * 4294967296 + +((c[Qa + (n + -2 << 2) >> 2] | 0) >>> 0)) * 4294967296;
					n = (n << 5) + -96 | 0;
					Ta = 63;
				}
				if ((Ta | 0) == 63) if ((e | 0) < 0) o = -o;
				h[g >> 3] = m * (+Yf(o, n) * .25);
			}
			if (k) {
				e = c[Qa + 776 >> 2] | 0;
				n = (e | 0) > -1 ? e : 0 - e | 0;
				if ((n | 0) == 1) {
					o = +((c[p >> 2] | 0) >>> 0);
					n = 0;
					Ta = 71;
				} else if ((n | 0) == 2) {
					o = +((c[Qa + 524 >> 2] | 0) >>> 0) * 4294967296 + +((c[p >> 2] | 0) >>> 0);
					n = 0;
					Ta = 71;
				} else if (!n) {
					o = 0;
					n = 0;
				} else {
					o = +((c[Qa + (n + -3 << 2) + 520 >> 2] | 0) >>> 0) + (+((c[Qa + (n + -1 << 2) + 520 >> 2] | 0) >>> 0) * 4294967296 + +((c[Qa + (n + -2 << 2) + 520 >> 2] | 0) >>> 0)) * 4294967296;
					n = (n << 5) + -96 | 0;
					Ta = 71;
				}
				if ((Ta | 0) == 71) if ((e | 0) < 0) o = -o;
				h[g + 8 >> 3] = m * (+Yf(o, n) * .25);
			}
			if (l) {
				Mf(Pa, a, Qa, Ra);
				o = m * (+Yf(+h[Pa >> 3], c[Pa + 8 >> 2] | 0) * .25);
				n = c[Sa + 256 >> 2] | 0;
				e = (n | 0) > -1 ? n : 0 - n | 0;
				if (!e) {
					m = 0;
					e = 0;
				} else if ((e | 0) == 1) {
					m = +((c[Sa >> 2] | 0) >>> 0);
					e = 0;
					Ta = 79;
				} else if ((e | 0) == 2) {
					m = +((c[Sa + 4 >> 2] | 0) >>> 0) * 4294967296 + +((c[Sa >> 2] | 0) >>> 0);
					e = 0;
					Ta = 79;
				} else {
					m = +((c[Sa + (e + -3 << 2) >> 2] | 0) >>> 0) + (+((c[Sa + (e + -1 << 2) >> 2] | 0) >>> 0) * 4294967296 + +((c[Sa + (e + -2 << 2) >> 2] | 0) >>> 0)) * 4294967296;
					e = (e << 5) + -96 | 0;
					Ta = 79;
				}
				if ((Ta | 0) == 79) if ((n | 0) < 0) m = -m;
				h[g + 16 >> 3] = o / +P(+ +Yf(m, e));
			}
			i = Ua;
			return;
		}
		function Hf(b, d, e, f, g, j, k, l, m) {
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			g = g | 0;
			j = j | 0;
			k = k | 0;
			l = l | 0;
			m = m | 0;
			var n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0, v = 0, w = 0, x = 0, y = 0, z = 0, A = 0, B = 0, C = 0, E = 0, F = 0, G = 0, H = 0, I = 0, J = 0, K = 0, L = 0, M = 0, N = 0, O = 0, P = 0, Q = 0, R = 0, S = 0, T = 0, U = 0, V = 0, W = 0, X = 0, Y = 0, Z = 0, _ = 0, aa = 0, ba = 0, ca = 0, da = 0, ea = 0, fa = 0, ga = 0, ha = 0, ia = 0, ja = 0, ka = 0, la = 0, ma = 0, na = 0, oa = 0, pa = 0, qa = 0, ra = 0, sa = 0, ta = 0, ua = 0, va = 0, wa = 0, xa = 0, ya = 0, za = 0, Aa = 0, Ba = 0, Ca = 0, Da = 0, Ea = 0, Fa = 0, Ga = 0, Ha = 0, Ia = 0, Ja = 0, Ka = 0, La = 0, Ma = 0, Na = 0, Oa = 0, Pa = 0, Qa = 0, Ra = 0, Sa = 0, Ta = 0, Ua = 0, Va = 0, Wa = 0, Xa = 0, Ya = 0, Za = 0, _a = 0, $a = 0, ab = 0, bb = 0, cb = 0, db = 0, eb = 0, fb = 0, gb = 0, hb = 0, ib = 0, jb = 0, kb = 0, lb = 0, mb = 0, nb = 0, ob = 0, pb = 0, qb = 0, rb = 0, sb = 0, tb = 0, ub = 0, vb = 0, wb = 0, xb = 0, yb = 0, zb = 0, Ab = 0, Bb = 0, Cb = 0, Db = 0, Eb = 0, Fb = 0, Gb = 0, Hb = 0, Ib = 0, Jb = 0, Kb = 0, Lb = 0, Mb = 0, Nb = 0, Ob = 0, Pb = 0, Qb = 0, Rb = 0, Sb = 0, Tb = 0, Ub = 0, Vb = 0, Wb = 0, Xb = 0, Yb = 0, Zb = 0, _b = 0, $b = 0, ac = 0;
			ac = i;
			i = i + 34960 | 0;
			$b = ac + 34696 | 0;
			Xb = ac + 34176 | 0;
			Yb = ac + 33656 | 0;
			Tb = ac + 33136 | 0;
			Zb = ac + 32096 | 0;
			_b = ac + 31056 | 0;
			tb = ac + 30792 | 0;
			s = ac + 30532 | 0;
			p = ac + 30272 | 0;
			z = ac + 30012 | 0;
			x = ac + 29752 | 0;
			y = ac + 29492 | 0;
			Y = ac + 29232 | 0;
			ca = ac + 28972 | 0;
			na = ac + 28712 | 0;
			Vb = ac + 28452 | 0;
			ua = ac + 28192 | 0;
			va = ac + 27932 | 0;
			Wb = ac + 27672 | 0;
			rb = ac + 27412 | 0;
			sb = ac + 27152 | 0;
			zb = ac + 26892 | 0;
			ub = ac + 26632 | 0;
			vb = ac + 26372 | 0;
			wb = ac + 26112 | 0;
			xb = ac + 25852 | 0;
			Ab = ac + 25592 | 0;
			Bb = ac + 25332 | 0;
			Cb = ac + 25072 | 0;
			Db = ac + 96 | 0;
			Kb = ac + 24812 | 0;
			Gb = ac + 24552 | 0;
			Hb = ac + 24292 | 0;
			Ib = ac + 24032 | 0;
			Jb = ac + 23772 | 0;
			Lb = ac + 23512 | 0;
			Mb = ac + 23252 | 0;
			Nb = ac + 22992 | 0;
			Ob = ac + 80 | 0;
			Pb = ac + 22732 | 0;
			Qb = ac + 22472 | 0;
			Rb = ac + 22212 | 0;
			Sb = ac + 64 | 0;
			B = ac + 21952 | 0;
			C = ac + 21692 | 0;
			E = ac + 21432 | 0;
			F = ac + 21172 | 0;
			G = ac + 20912 | 0;
			H = ac + 20652 | 0;
			I = ac + 20392 | 0;
			J = ac + 20132 | 0;
			K = ac + 19872 | 0;
			L = ac + 19612 | 0;
			ob = ac + 19352 | 0;
			M = ac + 19092 | 0;
			pb = ac + 18832 | 0;
			N = ac + 18572 | 0;
			qb = ac + 18312 | 0;
			O = ac + 18052 | 0;
			P = ac + 17792 | 0;
			Q = ac + 17532 | 0;
			R = ac + 17272 | 0;
			S = ac + 17012 | 0;
			T = ac + 16752 | 0;
			U = ac + 16492 | 0;
			V = ac + 16232 | 0;
			W = ac + 15972 | 0;
			X = ac + 15712 | 0;
			Z = ac + 15452 | 0;
			_ = ac + 15192 | 0;
			aa = ac + 14932 | 0;
			ba = ac + 14672 | 0;
			da = ac + 14412 | 0;
			ea = ac + 14152 | 0;
			fa = ac + 13892 | 0;
			ga = ac + 13632 | 0;
			ha = ac + 13372 | 0;
			ia = ac + 13112 | 0;
			ja = ac + 12852 | 0;
			ka = ac + 12592 | 0;
			la = ac + 12332 | 0;
			ma = ac + 12072 | 0;
			oa = ac + 11812 | 0;
			pa = ac + 11552 | 0;
			qa = ac + 11292 | 0;
			ra = ac + 48 | 0;
			Qa = ac + 11032 | 0;
			Ra = ac + 10772 | 0;
			Sa = ac + 10512 | 0;
			Ta = ac + 10252 | 0;
			Ua = ac + 9992 | 0;
			Va = ac + 9732 | 0;
			Wa = ac + 9472 | 0;
			Xa = ac + 9212 | 0;
			Ya = ac + 8952 | 0;
			Za = ac + 8692 | 0;
			_a = ac + 8432 | 0;
			$a = ac + 8172 | 0;
			ab = ac + 7912 | 0;
			bb = ac + 7652 | 0;
			cb = ac + 7392 | 0;
			db = ac + 7132 | 0;
			eb = ac + 6872 | 0;
			fb = ac + 6612 | 0;
			gb = ac + 6352 | 0;
			hb = ac + 32 | 0;
			ib = ac + 6092 | 0;
			jb = ac + 5832 | 0;
			kb = ac + 5572 | 0;
			lb = ac + 5312 | 0;
			mb = ac + 5052 | 0;
			nb = ac + 4792 | 0;
			wa = ac + 4532 | 0;
			xa = ac + 4272 | 0;
			ya = ac + 4012 | 0;
			za = ac + 3752 | 0;
			Aa = ac + 3492 | 0;
			Ba = ac + 3232 | 0;
			Ca = ac + 2972 | 0;
			Da = ac + 2712 | 0;
			Ea = ac + 2452 | 0;
			Fa = ac + 2192 | 0;
			Ga = ac + 1932 | 0;
			Ha = ac + 1672 | 0;
			Ia = ac + 1412 | 0;
			Ja = ac + 16 | 0;
			Ka = ac + 1152 | 0;
			La = ac + 892 | 0;
			Ma = ac + 632 | 0;
			Na = ac + 372 | 0;
			Oa = ac + 112 | 0;
			Pa = ac;
			u = c[e >> 2] | 0;
			Eb = e + 8 | 0;
			v = c[Eb >> 2] | 0;
			v = Xg(u | 0, ((u | 0) < 0) << 31 >> 31 | 0, v | 0, ((v | 0) < 0) << 31 >> 31 | 0) | 0;
			u = D;
			do if (!((u | 0) > 0 | (u | 0) == 0 & v >>> 0 > 0)) if ((u | 0) < 0) {
				sa = Xg(0, 0, v | 0, u | 0) | 0;
				ta = D;
				c[Xb >> 2] = sa;
				c[Xb + 4 >> 2] = ta;
				c[Xb + 256 >> 2] = (ta | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[Xb + 256 >> 2] = 0;
				break;
			} else {
				c[Xb >> 2] = v;
				c[Xb + 4 >> 2] = u;
				c[Xb + 256 >> 2] = (u | 0) != 0 ? 2 : 1;
			} while (0);
			n = e + 4 | 0;
			u = c[n >> 2] | 0;
			Fb = e + 12 | 0;
			v = c[Fb >> 2] | 0;
			v = Xg(u | 0, ((u | 0) < 0) << 31 >> 31 | 0, v | 0, ((v | 0) < 0) << 31 >> 31 | 0) | 0;
			u = D;
			do if (!((u | 0) > 0 | (u | 0) == 0 & v >>> 0 > 0)) if ((u | 0) < 0) {
				sa = Xg(0, 0, v | 0, u | 0) | 0;
				ta = D;
				c[Yb >> 2] = sa;
				c[Yb + 4 >> 2] = ta;
				c[Yb + 256 >> 2] = (ta | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[Yb + 256 >> 2] = 0;
				break;
			} else {
				c[Yb >> 2] = v;
				c[Yb + 4 >> 2] = u;
				c[Yb + 256 >> 2] = (u | 0) != 0 ? 2 : 1;
			} while (0);
			ta = Xb + 260 | 0;
			w = f + 8 | 0;
			u = c[w >> 2] | 0;
			v = c[f >> 2] | 0;
			v = Xg(u | 0, ((u | 0) < 0) << 31 >> 31 | 0, v | 0, ((v | 0) < 0) << 31 >> 31 | 0) | 0;
			u = D;
			do if (!((u | 0) > 0 | (u | 0) == 0 & v >>> 0 > 0)) if ((u | 0) < 0) {
				A = Xg(0, 0, v | 0, u | 0) | 0;
				sa = D;
				c[ta >> 2] = A;
				c[Xb + 264 >> 2] = sa;
				c[Xb + 516 >> 2] = (sa | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[Xb + 516 >> 2] = 0;
				break;
			} else {
				c[ta >> 2] = v;
				c[Xb + 264 >> 2] = u;
				c[Xb + 516 >> 2] = (u | 0) != 0 ? 2 : 1;
			} while (0);
			sa = Yb + 260 | 0;
			t = f + 12 | 0;
			u = c[t >> 2] | 0;
			yb = f + 4 | 0;
			v = c[yb >> 2] | 0;
			v = Xg(u | 0, ((u | 0) < 0) << 31 >> 31 | 0, v | 0, ((v | 0) < 0) << 31 >> 31 | 0) | 0;
			u = D;
			do if (!((u | 0) > 0 | (u | 0) == 0 & v >>> 0 > 0)) if ((u | 0) < 0) {
				u = Xg(0, 0, v | 0, u | 0) | 0;
				A = D;
				c[sa >> 2] = u;
				c[Yb + 264 >> 2] = A;
				c[Yb + 516 >> 2] = (A | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[Yb + 516 >> 2] = 0;
				break;
			} else {
				c[sa >> 2] = v;
				c[Yb + 264 >> 2] = u;
				c[Yb + 516 >> 2] = (u | 0) != 0 ? 2 : 1;
			} while (0);
			Jf(s, ta, Yb);
			Jf(p, Xb, sa);
			Kf(tb, s, p);
			A = tb + 256 | 0;
			if (c[A >> 2] | 0) {
				v = c[e >> 2] | 0;
				do if ((v | 0) <= 0) if ((v | 0) < 0) {
					c[$b >> 2] = 0 - v;
					c[$b + 256 >> 2] = -1;
					break;
				} else {
					c[$b + 256 >> 2] = 0;
					break;
				} else {
					c[$b >> 2] = v;
					c[$b + 256 >> 2] = 1;
				} while (0);
				Jf(C, Yb, $b);
				v = c[n >> 2] | 0;
				do if ((v | 0) <= 0) if ((v | 0) < 0) {
					c[$b >> 2] = 0 - v;
					c[$b + 256 >> 2] = -1;
					break;
				} else {
					c[$b + 256 >> 2] = 0;
					break;
				} else {
					c[$b >> 2] = v;
					c[$b + 256 >> 2] = 1;
				} while (0);
				Jf(E, Xb, $b);
				Kf(B, C, E);
				bh(Tb | 0, B | 0, 260) | 0;
				u = Tb + 260 | 0;
				v = c[t >> 2] | 0;
				do if ((v | 0) <= 0) if ((v | 0) < 0) {
					c[$b >> 2] = 0 - v;
					c[$b + 256 >> 2] = -1;
					break;
				} else {
					c[$b + 256 >> 2] = 0;
					break;
				} else {
					c[$b >> 2] = v;
					c[$b + 256 >> 2] = 1;
				} while (0);
				Jf(G, ta, $b);
				v = c[w >> 2] | 0;
				do if ((v | 0) <= 0) if ((v | 0) < 0) {
					c[$b >> 2] = 0 - v;
					c[$b + 256 >> 2] = -1;
					break;
				} else {
					c[$b + 256 >> 2] = 0;
					break;
				} else {
					c[$b >> 2] = v;
					c[$b + 256 >> 2] = 1;
				} while (0);
				Jf(H, sa, $b);
				Kf(F, G, H);
				bh(u | 0, F | 0, 260) | 0;
				Jf(I, Xb, u);
				Jf(J, ta, Tb);
				Lf(Vb, I, J);
				Jf(K, Yb, u);
				Jf(L, sa, Tb);
				Lf(Wb, K, L);
				v = c[d >> 2] | 0;
				do if ((v | 0) <= 0) if ((v | 0) < 0) {
					c[$b >> 2] = 0 - v;
					c[$b + 256 >> 2] = -1;
					break;
				} else {
					c[$b + 256 >> 2] = 0;
					break;
				} else {
					c[$b >> 2] = v;
					c[$b + 256 >> 2] = 1;
				} while (0);
				Jf(M, tb, $b);
				Kf(ob, Vb, M);
				v = c[d + 4 >> 2] | 0;
				do if ((v | 0) <= 0) if ((v | 0) < 0) {
					c[$b >> 2] = 0 - v;
					c[$b + 256 >> 2] = -1;
					break;
				} else {
					c[$b + 256 >> 2] = 0;
					break;
				} else {
					c[$b >> 2] = v;
					c[$b + 256 >> 2] = 1;
				} while (0);
				Jf(N, tb, $b);
				Kf(pb, Wb, N);
				if ((c[ob + 256 >> 2] | 0) == 0 ? (c[pb + 256 >> 2] | 0) == 0 : 0) {
					p = c[A >> 2] | 0;
					n = (p | 0) > -1 ? p : 0 - p | 0;
					if ((n | 0) == 2) {
						o = +((c[tb + 4 >> 2] | 0) >>> 0) * 4294967296 + +((c[tb >> 2] | 0) >>> 0);
						n = 0;
						Ub = 132;
					} else if ((n | 0) == 1) {
						o = +((c[tb >> 2] | 0) >>> 0);
						n = 0;
						Ub = 132;
					} else if (!n) {
						o = 0;
						n = 0;
					} else {
						o = +((c[tb + (n + -3 << 2) >> 2] | 0) >>> 0) + (+((c[tb + (n + -1 << 2) >> 2] | 0) >>> 0) * 4294967296 + +((c[tb + (n + -2 << 2) >> 2] | 0) >>> 0)) * 4294967296;
						n = (n << 5) + -96 | 0;
						Ub = 132;
					}
					if ((Ub | 0) == 132) if ((p | 0) < 0) o = -o;
					r = +Yf(o, n);
					p = c[Vb + 256 >> 2] | 0;
					n = (p | 0) > -1 ? p : 0 - p | 0;
					if ((n | 0) == 2) {
						o = +((c[Vb + 4 >> 2] | 0) >>> 0) * 4294967296 + +((c[Vb >> 2] | 0) >>> 0);
						n = 0;
						Ub = 138;
					} else if (!n) {
						o = 0;
						n = 0;
					} else if ((n | 0) == 1) {
						o = +((c[Vb >> 2] | 0) >>> 0);
						n = 0;
						Ub = 138;
					} else {
						o = +((c[Vb + (n + -3 << 2) >> 2] | 0) >>> 0) + (+((c[Vb + (n + -1 << 2) >> 2] | 0) >>> 0) * 4294967296 + +((c[Vb + (n + -2 << 2) >> 2] | 0) >>> 0)) * 4294967296;
						n = (n << 5) + -96 | 0;
						Ub = 138;
					}
					if ((Ub | 0) == 138) if ((p | 0) < 0) o = -o;
					q = +Yf(o, n) / r;
					p = c[Wb + 256 >> 2] | 0;
					n = (p | 0) > -1 ? p : 0 - p | 0;
					if ((n | 0) == 2) {
						o = +((c[Wb + 4 >> 2] | 0) >>> 0) * 4294967296 + +((c[Wb >> 2] | 0) >>> 0);
						n = 0;
						Ub = 144;
					} else if (!n) {
						o = 0;
						n = 0;
					} else if ((n | 0) == 1) {
						o = +((c[Wb >> 2] | 0) >>> 0);
						n = 0;
						Ub = 144;
					} else {
						o = +((c[Wb + (n + -3 << 2) >> 2] | 0) >>> 0) + (+((c[Wb + (n + -1 << 2) >> 2] | 0) >>> 0) * 4294967296 + +((c[Wb + (n + -2 << 2) >> 2] | 0) >>> 0)) * 4294967296;
						n = (n << 5) + -96 | 0;
						Ub = 144;
					}
					if ((Ub | 0) == 144) if ((p | 0) < 0) o = -o;
					o = +Yf(o, n) / r;
					h[j >> 3] = q;
					h[j + 8 >> 3] = o;
					h[j + 16 >> 3] = q;
					a[j + 24 >> 0] = 1;
				} else {
					v = $((c[A >> 2] >> 31 & 2) + -1 | 0, (g | 0) == 2 ? 1 : -1) | 0;
					do if ((v | 0) <= 0) if ((v | 0) < 0) {
						c[qb >> 2] = 0 - v;
						c[qb + 256 >> 2] = -1;
						break;
					} else {
						c[qb + 256 >> 2] = 0;
						break;
					} else {
						c[qb >> 2] = v;
						c[qb + 256 >> 2] = 1;
					} while (0);
					bh(P | 0, ob | 0, 260) | 0;
					p = P + 256 | 0;
					c[p >> 2] = 0 - (c[p >> 2] | 0);
					Jf(Q, ta, P);
					bh(S | 0, pb | 0, 260) | 0;
					p = S + 256 | 0;
					c[p >> 2] = 0 - (c[p >> 2] | 0);
					Jf(R, sa, S);
					Lf(O, Q, R);
					bh(Zb | 0, O | 0, 260) | 0;
					p = Zb + 260 | 0;
					bh(U | 0, ob | 0, 260) | 0;
					t = U + 256 | 0;
					c[t >> 2] = 0 - (c[t >> 2] | 0);
					Jf(V, Xb, U);
					bh(X | 0, pb | 0, 260) | 0;
					t = X + 256 | 0;
					c[t >> 2] = 0 - (c[t >> 2] | 0);
					Jf(W, Yb, X);
					Lf(T, V, W);
					bh(p | 0, T | 0, 260) | 0;
					t = Zb + 520 | 0;
					bh(t | 0, qb | 0, 260) | 0;
					s = Zb + 780 | 0;
					c[Zb + 1036 >> 2] = 0;
					Jf(_, Xb, Xb);
					Jf(aa, Yb, Yb);
					Lf(Z, _, aa);
					bh(_b | 0, Z | 0, 260) | 0;
					Jf(da, ta, ta);
					Jf(ea, sa, sa);
					Lf(ba, da, ea);
					bh(_b + 260 | 0, ba | 0, 260) | 0;
					Jf(ga, Xb, ta);
					Jf(ha, Yb, sa);
					Lf(fa, ga, ha);
					bh(_b + 520 | 0, fa | 0, 260) | 0;
					Jf(ja, Xb, pb);
					Jf(ka, Yb, ob);
					Kf(la, ja, ka);
					Jf(oa, ta, pb);
					Jf(pa, sa, ob);
					Kf(ma, oa, pa);
					Jf(qa, la, ma);
					c[$b >> 2] = 2;
					c[$b + 256 >> 2] = -1;
					Jf(ia, qa, $b);
					bh(_b + 780 | 0, ia | 0, 260) | 0;
					Pf(ra, b, Zb, _b);
					q = +Yf(+h[ra >> 3], c[ra + 8 >> 2] | 0);
					u = c[A >> 2] | 0;
					v = (u | 0) > -1 ? u : 0 - u | 0;
					if (!v) {
						r = 0;
						v = 0;
					} else if ((v | 0) == 1) {
						r = +((c[tb >> 2] | 0) >>> 0);
						v = 0;
						Ub = 156;
					} else if ((v | 0) == 2) {
						r = +((c[tb + 4 >> 2] | 0) >>> 0) * 4294967296 + +((c[tb >> 2] | 0) >>> 0);
						v = 0;
						Ub = 156;
					} else {
						r = +((c[tb + (v + -3 << 2) >> 2] | 0) >>> 0) + (+((c[tb + (v + -1 << 2) >> 2] | 0) >>> 0) * 4294967296 + +((c[tb + (v + -2 << 2) >> 2] | 0) >>> 0)) * 4294967296;
						v = (v << 5) + -96 | 0;
						Ub = 156;
					}
					if ((Ub | 0) == 156) if ((u | 0) < 0) r = -r;
					r = q * +Yf(r, v);
					if (l) {
						Jf(Sa, ob, ob);
						Jf(Ta, pb, pb);
						Lf(Ra, Sa, Ta);
						Jf(Ua, sa, Ra);
						Jf(Xa, ob, ta);
						Jf(Ya, pb, sa);
						Lf(Wa, Xa, Ya);
						Jf(Va, Wb, Wa);
						Kf(Qa, Ua, Va);
						bh(Zb | 0, Qa | 0, 260) | 0;
						Jf($a, ob, ob);
						Jf(ab, pb, pb);
						Lf(_a, $a, ab);
						Jf(bb, Yb, _a);
						Jf(eb, ob, Xb);
						Jf(fb, pb, Yb);
						Lf(db, eb, fb);
						Jf(cb, Wb, db);
						Kf(Za, bb, cb);
						bh(p | 0, Za | 0, 260) | 0;
						Jf(gb, Wb, qb);
						bh(t | 0, gb | 0, 260) | 0;
						Pf(hb, b, Zb, _b);
						h[j + 8 >> 3] = +Yf(+h[hb >> 3], c[hb + 8 >> 2] | 0) / r;
					}
					if (k | m) {
						Jf(kb, ob, ob);
						Jf(lb, pb, pb);
						Lf(jb, kb, lb);
						Jf(mb, ta, jb);
						Jf(xa, ob, ta);
						Jf(ya, pb, sa);
						Lf(wa, xa, ya);
						Jf(nb, Vb, wa);
						Kf(ib, mb, nb);
						bh(Zb | 0, ib | 0, 260) | 0;
						Jf(Ba, ob, ob);
						Jf(Ca, pb, pb);
						Lf(Aa, Ba, Ca);
						Jf(Da, Xb, Aa);
						Jf(Ga, ob, Xb);
						Jf(Ha, pb, Yb);
						Lf(Fa, Ga, Ha);
						Jf(Ea, Vb, Fa);
						Kf(za, Da, Ea);
						bh(p | 0, za | 0, 260) | 0;
						Jf(Ia, Vb, qb);
						bh(t | 0, Ia | 0, 260) | 0;
						if (k) {
							Pf(Ja, b, Zb, _b);
							h[j >> 3] = +Yf(+h[Ja >> 3], c[Ja + 8 >> 2] | 0) / r;
						}
						if (m) {
							Jf(Ma, ob, ob);
							Jf(Na, pb, pb);
							Lf(La, Ma, Na);
							Jf(Oa, tb, La);
							c[$b >> 2] = 1;
							c[$b + 256 >> 2] = q < 0 ? -1 : 1;
							Jf(Ka, Oa, $b);
							bh(s | 0, Ka | 0, 260) | 0;
							Pf(Pa, b, Zb, _b);
							h[j + 16 >> 3] = +Yf(+h[Pa >> 3], c[Pa + 8 >> 2] | 0) / r;
						}
					}
				}
				i = ac;
				return;
			}
			Jf(x, Xb, Xb);
			Jf(y, Yb, Yb);
			Lf(z, x, y);
			t = c[z + 256 >> 2] | 0;
			u = (t | 0) > -1 ? t : 0 - t | 0;
			if ((u | 0) == 2) {
				r = +((c[z + 4 >> 2] | 0) >>> 0) * 4294967296 + +((c[z >> 2] | 0) >>> 0);
				u = 0;
				Ub = 26;
			} else if ((u | 0) == 1) {
				r = +((c[z >> 2] | 0) >>> 0);
				u = 0;
				Ub = 26;
			} else if (!u) {
				r = 0;
				u = 0;
			} else {
				r = +((c[z + (u + -3 << 2) >> 2] | 0) >>> 0) + (+((c[z + (u + -1 << 2) >> 2] | 0) >>> 0) * 4294967296 + +((c[z + (u + -2 << 2) >> 2] | 0) >>> 0)) * 4294967296;
				u = (u << 5) + -96 | 0;
				Ub = 26;
			}
			if ((Ub | 0) == 26) if ((t | 0) < 0) r = -r;
			r = +Yf(r, u) * 2;
			t = c[f >> 2] | 0;
			u = c[Eb >> 2] | 0;
			u = Xg(t | 0, ((t | 0) < 0) << 31 >> 31 | 0, u | 0, ((u | 0) < 0) << 31 >> 31 | 0) | 0;
			t = D;
			do if (!((t | 0) > 0 | (t | 0) == 0 & u >>> 0 > 0)) if ((t | 0) < 0) {
				cb = Xg(0, 0, u | 0, t | 0) | 0;
				eb = D;
				c[$b >> 2] = cb;
				c[$b + 4 >> 2] = eb;
				c[$b + 256 >> 2] = (eb | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[$b + 256 >> 2] = 0;
				break;
			} else {
				c[$b >> 2] = u;
				c[$b + 4 >> 2] = t;
				c[$b + 256 >> 2] = (t | 0) != 0 ? 2 : 1;
			} while (0);
			Jf(ca, Yb, $b);
			t = c[yb >> 2] | 0;
			u = c[Fb >> 2] | 0;
			u = Xg(t | 0, ((t | 0) < 0) << 31 >> 31 | 0, u | 0, ((u | 0) < 0) << 31 >> 31 | 0) | 0;
			t = D;
			do if (!((t | 0) > 0 | (t | 0) == 0 & u >>> 0 > 0)) if ((t | 0) < 0) {
				cb = Xg(0, 0, u | 0, t | 0) | 0;
				eb = D;
				c[$b >> 2] = cb;
				c[$b + 4 >> 2] = eb;
				c[$b + 256 >> 2] = (eb | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[$b + 256 >> 2] = 0;
				break;
			} else {
				c[$b >> 2] = u;
				c[$b + 4 >> 2] = t;
				c[$b + 256 >> 2] = (t | 0) != 0 ? 2 : 1;
			} while (0);
			Jf(na, Xb, $b);
			Kf(Y, ca, na);
			bh(Tb | 0, Y | 0, 260) | 0;
			v = d + 4 | 0;
			t = c[v >> 2] | 0;
			u = c[Fb >> 2] | 0;
			u = Xg(t | 0, ((t | 0) < 0) << 31 >> 31 | 0, u | 0, ((u | 0) < 0) << 31 >> 31 | 0) | 0;
			t = D;
			do if (!((t | 0) > 0 | (t | 0) == 0 & u >>> 0 > 0)) if ((t | 0) < 0) {
				cb = Xg(0, 0, u | 0, t | 0) | 0;
				eb = D;
				c[$b >> 2] = cb;
				c[$b + 4 >> 2] = eb;
				c[$b + 256 >> 2] = (eb | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[$b + 256 >> 2] = 0;
				break;
			} else {
				c[$b >> 2] = u;
				c[$b + 4 >> 2] = t;
				c[$b + 256 >> 2] = (t | 0) != 0 ? 2 : 1;
			} while (0);
			Jf(ua, Xb, $b);
			t = c[d >> 2] | 0;
			u = c[Eb >> 2] | 0;
			u = Xg(t | 0, ((t | 0) < 0) << 31 >> 31 | 0, u | 0, ((u | 0) < 0) << 31 >> 31 | 0) | 0;
			t = D;
			do if (!((t | 0) > 0 | (t | 0) == 0 & u >>> 0 > 0)) if ((t | 0) < 0) {
				cb = Xg(0, 0, u | 0, t | 0) | 0;
				eb = D;
				c[$b >> 2] = cb;
				c[$b + 4 >> 2] = eb;
				c[$b + 256 >> 2] = (eb | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[$b + 256 >> 2] = 0;
				break;
			} else {
				c[$b >> 2] = u;
				c[$b + 4 >> 2] = t;
				c[$b + 256 >> 2] = (t | 0) != 0 ? 2 : 1;
			} while (0);
			Jf(va, Yb, $b);
			Kf(Vb, ua, va);
			t = c[d >> 2] | 0;
			u = c[f >> 2] | 0;
			u = Xg(t | 0, ((t | 0) < 0) << 31 >> 31 | 0, u | 0, ((u | 0) < 0) << 31 >> 31 | 0) | 0;
			t = D;
			do if (!((t | 0) > 0 | (t | 0) == 0 & u >>> 0 > 0)) if ((t | 0) < 0) {
				cb = Xg(0, 0, u | 0, t | 0) | 0;
				eb = D;
				c[$b >> 2] = cb;
				c[$b + 4 >> 2] = eb;
				c[$b + 256 >> 2] = (eb | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[$b + 256 >> 2] = 0;
				break;
			} else {
				c[$b >> 2] = u;
				c[$b + 4 >> 2] = t;
				c[$b + 256 >> 2] = (t | 0) != 0 ? 2 : 1;
			} while (0);
			Jf(rb, Yb, $b);
			t = c[v >> 2] | 0;
			u = c[yb >> 2] | 0;
			u = Xg(t | 0, ((t | 0) < 0) << 31 >> 31 | 0, u | 0, ((u | 0) < 0) << 31 >> 31 | 0) | 0;
			t = D;
			do if (!((t | 0) > 0 | (t | 0) == 0 & u >>> 0 > 0)) if ((t | 0) < 0) {
				cb = Xg(0, 0, u | 0, t | 0) | 0;
				eb = D;
				c[$b >> 2] = cb;
				c[$b + 4 >> 2] = eb;
				c[$b + 256 >> 2] = (eb | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[$b + 256 >> 2] = 0;
				break;
			} else {
				c[$b >> 2] = u;
				c[$b + 4 >> 2] = t;
				c[$b + 256 >> 2] = (t | 0) != 0 ? 2 : 1;
			} while (0);
			Jf(sb, Xb, $b);
			Kf(Wb, rb, sb);
			Jf(_b, Vb, Wb);
			c[_b + 260 >> 2] = 1;
			c[_b + 516 >> 2] = 1;
			if (l) {
				c[$b >> 2] = 2;
				c[$b + 256 >> 2] = (g | 0) == 2 ? 1 : -1;
				Jf(Zb, Yb, $b);
				n = Zb + 260 | 0;
				Jf(ub, Xb, Xb);
				u = c[Fb >> 2] | 0;
				t = c[yb >> 2] | 0;
				u = $g(t | 0, ((t | 0) < 0) << 31 >> 31 | 0, u | 0, ((u | 0) < 0) << 31 >> 31 | 0) | 0;
				t = D;
				do if (!((t | 0) > 0 | (t | 0) == 0 & u >>> 0 > 0)) if ((t | 0) < 0) {
					cb = Xg(0, 0, u | 0, t | 0) | 0;
					eb = D;
					c[$b >> 2] = cb;
					c[$b + 4 >> 2] = eb;
					c[$b + 256 >> 2] = (eb | 0) != 0 ? -2 : -1;
					break;
				} else {
					c[$b + 256 >> 2] = 0;
					break;
				} else {
					c[$b >> 2] = u;
					c[$b + 4 >> 2] = t;
					c[$b + 256 >> 2] = (t | 0) != 0 ? 2 : 1;
				} while (0);
				Jf(vb, ub, $b);
				Jf(xb, Xb, Yb);
				eb = c[Eb >> 2] | 0;
				t = c[f >> 2] | 0;
				eb = $g(t | 0, ((t | 0) < 0) << 31 >> 31 | 0, eb | 0, ((eb | 0) < 0) << 31 >> 31 | 0) | 0;
				t = D;
				u = c[d >> 2] | 0;
				u = Zg(u | 0, ((u | 0) < 0) << 31 >> 31 | 0, 1) | 0;
				u = Xg(eb | 0, t | 0, u | 0, D | 0) | 0;
				t = D;
				do if (!((t | 0) > 0 | (t | 0) == 0 & u >>> 0 > 0)) if ((t | 0) < 0) {
					cb = Xg(0, 0, u | 0, t | 0) | 0;
					eb = D;
					c[$b >> 2] = cb;
					c[$b + 4 >> 2] = eb;
					c[$b + 256 >> 2] = (eb | 0) != 0 ? -2 : -1;
					break;
				} else {
					c[$b + 256 >> 2] = 0;
					break;
				} else {
					c[$b >> 2] = u;
					c[$b + 4 >> 2] = t;
					c[$b + 256 >> 2] = (t | 0) != 0 ? 2 : 1;
				} while (0);
				Jf(wb, xb, $b);
				Kf(Ab, vb, wb);
				Jf(Cb, Yb, Yb);
				u = c[v >> 2] | 0;
				t = ((u | 0) < 0) << 31 >> 31;
				s = Zg(u | 0, t | 0, 1) | 0;
				p = D;
				do if ((u | 0) <= 0) if ((u | 0) < 0) {
					cb = Xg(0, 0, s | 0, p | 0) | 0;
					eb = D;
					c[$b >> 2] = cb;
					c[$b + 4 >> 2] = eb;
					c[$b + 256 >> 2] = (eb | 0) != 0 ? -2 : -1;
					break;
				} else {
					c[$b + 256 >> 2] = 0;
					break;
				} else {
					c[$b >> 2] = s;
					eb = ah(u | 0, t | 0, 31) | 0;
					c[$b + 4 >> 2] = eb;
					c[$b + 256 >> 2] = (eb | 0) != 0 ? 2 : 1;
				} while (0);
				Jf(Bb, Cb, $b);
				Lf(zb, Ab, Bb);
				bh(n | 0, zb | 0, 260) | 0;
				Mf(Db, b, Zb, _b);
				h[j + 8 >> 3] = +Yf(+h[Db >> 3], c[Db + 8 >> 2] | 0) / r;
			}
			if (k | m) {
				c[$b >> 2] = 2;
				c[$b + 256 >> 2] = (g | 0) == 2 ? 1 : -1;
				Jf(Zb, Xb, $b);
				u = Zb + 260 | 0;
				Jf(Gb, Yb, Yb);
				t = c[Eb >> 2] | 0;
				s = c[f >> 2] | 0;
				t = $g(s | 0, ((s | 0) < 0) << 31 >> 31 | 0, t | 0, ((t | 0) < 0) << 31 >> 31 | 0) | 0;
				s = D;
				do if (!((s | 0) > 0 | (s | 0) == 0 & t >>> 0 > 0)) if ((s | 0) < 0) {
					cb = Xg(0, 0, t | 0, s | 0) | 0;
					eb = D;
					c[$b >> 2] = cb;
					c[$b + 4 >> 2] = eb;
					c[$b + 256 >> 2] = (eb | 0) != 0 ? -2 : -1;
					break;
				} else {
					c[$b + 256 >> 2] = 0;
					break;
				} else {
					c[$b >> 2] = t;
					c[$b + 4 >> 2] = s;
					c[$b + 256 >> 2] = (s | 0) != 0 ? 2 : 1;
				} while (0);
				Jf(Hb, Gb, $b);
				Jf(Jb, Xb, Yb);
				eb = c[Fb >> 2] | 0;
				s = c[yb >> 2] | 0;
				eb = $g(s | 0, ((s | 0) < 0) << 31 >> 31 | 0, eb | 0, ((eb | 0) < 0) << 31 >> 31 | 0) | 0;
				s = D;
				t = c[v >> 2] | 0;
				t = Zg(t | 0, ((t | 0) < 0) << 31 >> 31 | 0, 1) | 0;
				t = Xg(eb | 0, s | 0, t | 0, D | 0) | 0;
				s = D;
				do if (!((s | 0) > 0 | (s | 0) == 0 & t >>> 0 > 0)) if ((s | 0) < 0) {
					cb = Xg(0, 0, t | 0, s | 0) | 0;
					eb = D;
					c[$b >> 2] = cb;
					c[$b + 4 >> 2] = eb;
					c[$b + 256 >> 2] = (eb | 0) != 0 ? -2 : -1;
					break;
				} else {
					c[$b + 256 >> 2] = 0;
					break;
				} else {
					c[$b >> 2] = t;
					c[$b + 4 >> 2] = s;
					c[$b + 256 >> 2] = (s | 0) != 0 ? 2 : 1;
				} while (0);
				Jf(Ib, Jb, $b);
				Kf(Lb, Hb, Ib);
				Jf(Nb, Xb, Xb);
				p = c[d >> 2] | 0;
				n = ((p | 0) < 0) << 31 >> 31;
				s = Zg(p | 0, n | 0, 1) | 0;
				t = D;
				do if ((p | 0) <= 0) if ((p | 0) < 0) {
					cb = Xg(0, 0, s | 0, t | 0) | 0;
					eb = D;
					c[$b >> 2] = cb;
					c[$b + 4 >> 2] = eb;
					c[$b + 256 >> 2] = (eb | 0) != 0 ? -2 : -1;
					break;
				} else {
					c[$b + 256 >> 2] = 0;
					break;
				} else {
					c[$b >> 2] = s;
					eb = ah(p | 0, n | 0, 31) | 0;
					c[$b + 4 >> 2] = eb;
					c[$b + 256 >> 2] = (eb | 0) != 0 ? 2 : 1;
				} while (0);
				Jf(Mb, Nb, $b);
				Lf(Kb, Lb, Mb);
				bh(u | 0, Kb | 0, 260) | 0;
				if (k) {
					Mf(Ob, b, Zb, _b);
					h[j >> 3] = +Yf(+h[Ob >> 3], c[Ob + 8 >> 2] | 0) / r;
				}
				if (m) {
					eb = c[Tb + 256 >> 2] | 0;
					bh(Zb + 520 | 0, Tb | 0, 256) | 0;
					c[Zb + 776 >> 2] = (eb | 0) < 0 ? 0 - eb | 0 : eb;
					Jf(Qb, Xb, Xb);
					Jf(Rb, Yb, Yb);
					Lf(Pb, Qb, Rb);
					bh(_b + 520 | 0, Pb | 0, 260) | 0;
					Of(Sb, b, Zb, _b);
					h[j + 16 >> 3] = +Yf(+h[Sb >> 3], c[Sb + 8 >> 2] | 0) / r;
				}
			}
			i = ac;
			return;
		}
		function If(a, b, d, e, f, g, j, k) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			g = g | 0;
			j = j | 0;
			k = k | 0;
			var l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0, v = 0, w = 0, x = 0, y = 0, z = 0, A = 0, B = 0, C = 0, E = 0, F = 0, G = 0, H = 0, I = 0, J = 0, K = 0, L = 0, M = 0, N = 0, O = 0, P = 0, Q = 0, R = 0, S = 0, T = 0, U = 0, V = 0, W = 0, X = 0, Y = 0, Z = 0, _ = 0, $ = 0, aa = 0, ba = 0, ca = 0, da = 0, ea = 0, fa = 0, ga = 0, ha = 0, ia = 0, ja = 0, ka = 0;
			ka = i;
			i = i + 8128 | 0;
			fa = ka + 7344 | 0;
			ga = ka + 6564 | 0;
			ha = ka + 5784 | 0;
			ia = ka + 4744 | 0;
			ja = ka + 3704 | 0;
			N = ka + 3444 | 0;
			O = ka + 3184 | 0;
			P = ka + 2924 | 0;
			R = ka + 2664 | 0;
			S = ka + 2404 | 0;
			U = ka + 2144 | 0;
			V = ka + 48 | 0;
			X = ka + 1884 | 0;
			Y = ka + 1624 | 0;
			Z = ka + 1364 | 0;
			W = ka + 32 | 0;
			_ = ka + 1104 | 0;
			$ = ka + 844 | 0;
			aa = ka + 584 | 0;
			ba = ka + 324 | 0;
			ca = ka + 64 | 0;
			da = ka + 16 | 0;
			ea = ka;
			z = c[b + 8 >> 2] | 0;
			A = ((z | 0) < 0) << 31 >> 31;
			B = c[b >> 2] | 0;
			C = ((B | 0) < 0) << 31 >> 31;
			o = Xg(z | 0, A | 0, B | 0, C | 0) | 0;
			n = D;
			do if (!((n | 0) > 0 | (n | 0) == 0 & o >>> 0 > 0)) if ((n | 0) < 0) {
				Q = Xg(0, 0, o | 0, n | 0) | 0;
				T = D;
				c[fa >> 2] = Q;
				c[fa + 4 >> 2] = T;
				c[fa + 256 >> 2] = (T | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[fa + 256 >> 2] = 0;
				break;
			} else {
				c[fa >> 2] = o;
				c[fa + 4 >> 2] = n;
				c[fa + 256 >> 2] = (n | 0) != 0 ? 2 : 1;
			} while (0);
			T = fa + 260 | 0;
			E = c[d + 8 >> 2] | 0;
			F = ((E | 0) < 0) << 31 >> 31;
			G = c[d >> 2] | 0;
			H = ((G | 0) < 0) << 31 >> 31;
			o = Xg(E | 0, F | 0, G | 0, H | 0) | 0;
			n = D;
			do if (!((n | 0) > 0 | (n | 0) == 0 & o >>> 0 > 0)) if ((n | 0) < 0) {
				M = Xg(0, 0, o | 0, n | 0) | 0;
				Q = D;
				c[T >> 2] = M;
				c[fa + 264 >> 2] = Q;
				c[fa + 516 >> 2] = (Q | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[fa + 516 >> 2] = 0;
				break;
			} else {
				c[T >> 2] = o;
				c[fa + 264 >> 2] = n;
				c[fa + 516 >> 2] = (n | 0) != 0 ? 2 : 1;
			} while (0);
			Q = fa + 520 | 0;
			I = c[e + 8 >> 2] | 0;
			J = ((I | 0) < 0) << 31 >> 31;
			K = c[e >> 2] | 0;
			L = ((K | 0) < 0) << 31 >> 31;
			o = Xg(I | 0, J | 0, K | 0, L | 0) | 0;
			n = D;
			do if (!((n | 0) > 0 | (n | 0) == 0 & o >>> 0 > 0)) if ((n | 0) < 0) {
				s = Xg(0, 0, o | 0, n | 0) | 0;
				M = D;
				c[Q >> 2] = s;
				c[fa + 524 >> 2] = M;
				c[fa + 776 >> 2] = (M | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[fa + 776 >> 2] = 0;
				break;
			} else {
				c[Q >> 2] = o;
				c[fa + 524 >> 2] = n;
				c[fa + 776 >> 2] = (n | 0) != 0 ? 2 : 1;
			} while (0);
			x = c[b + 12 >> 2] | 0;
			s = ((x | 0) < 0) << 31 >> 31;
			n = c[b + 4 >> 2] | 0;
			l = ((n | 0) < 0) << 31 >> 31;
			b = Xg(x | 0, s | 0, n | 0, l | 0) | 0;
			o = D;
			do if (!((o | 0) > 0 | (o | 0) == 0 & b >>> 0 > 0)) if ((o | 0) < 0) {
				r = Xg(0, 0, b | 0, o | 0) | 0;
				M = D;
				c[ga >> 2] = r;
				c[ga + 4 >> 2] = M;
				c[ga + 256 >> 2] = (M | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[ga + 256 >> 2] = 0;
				break;
			} else {
				c[ga >> 2] = b;
				c[ga + 4 >> 2] = o;
				c[ga + 256 >> 2] = (o | 0) != 0 ? 2 : 1;
			} while (0);
			M = ga + 260 | 0;
			t = c[d + 12 >> 2] | 0;
			u = ((t | 0) < 0) << 31 >> 31;
			p = c[d + 4 >> 2] | 0;
			q = ((p | 0) < 0) << 31 >> 31;
			b = Xg(t | 0, u | 0, p | 0, q | 0) | 0;
			o = D;
			do if (!((o | 0) > 0 | (o | 0) == 0 & b >>> 0 > 0)) if ((o | 0) < 0) {
				d = Xg(0, 0, b | 0, o | 0) | 0;
				r = D;
				c[M >> 2] = d;
				c[ga + 264 >> 2] = r;
				c[ga + 516 >> 2] = (r | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[ga + 516 >> 2] = 0;
				break;
			} else {
				c[M >> 2] = b;
				c[ga + 264 >> 2] = o;
				c[ga + 516 >> 2] = (o | 0) != 0 ? 2 : 1;
			} while (0);
			y = ga + 520 | 0;
			v = c[e + 12 >> 2] | 0;
			w = ((v | 0) < 0) << 31 >> 31;
			e = c[e + 4 >> 2] | 0;
			r = ((e | 0) < 0) << 31 >> 31;
			b = Xg(v | 0, w | 0, e | 0, r | 0) | 0;
			o = D;
			do if (!((o | 0) > 0 | (o | 0) == 0 & b >>> 0 > 0)) if ((o | 0) < 0) {
				b = Xg(0, 0, b | 0, o | 0) | 0;
				d = D;
				c[y >> 2] = b;
				c[ga + 524 >> 2] = d;
				c[ga + 776 >> 2] = (d | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[ga + 776 >> 2] = 0;
				break;
			} else {
				c[y >> 2] = b;
				c[ga + 524 >> 2] = o;
				c[ga + 776 >> 2] = (o | 0) != 0 ? 2 : 1;
			} while (0);
			s = ih(x | 0, s | 0, B | 0, C | 0) | 0;
			o = D;
			b = ih(z | 0, A | 0, n | 0, l | 0) | 0;
			b = Xg(s | 0, o | 0, b | 0, D | 0) | 0;
			o = D;
			do if (!((o | 0) > 0 | (o | 0) == 0 & b >>> 0 > 0)) if ((o | 0) < 0) {
				d = Xg(0, 0, b | 0, o | 0) | 0;
				s = D;
				c[ha >> 2] = d;
				c[ha + 4 >> 2] = s;
				c[ha + 256 >> 2] = (s | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[ha + 256 >> 2] = 0;
				break;
			} else {
				c[ha >> 2] = b;
				c[ha + 4 >> 2] = o;
				c[ha + 256 >> 2] = (o | 0) != 0 ? 2 : 1;
			} while (0);
			d = ha + 260 | 0;
			H = ih(t | 0, u | 0, G | 0, H | 0) | 0;
			n = D;
			o = ih(E | 0, F | 0, p | 0, q | 0) | 0;
			o = Xg(H | 0, n | 0, o | 0, D | 0) | 0;
			n = D;
			do if (!((n | 0) > 0 | (n | 0) == 0 & o >>> 0 > 0)) if ((n | 0) < 0) {
				G = Xg(0, 0, o | 0, n | 0) | 0;
				H = D;
				c[d >> 2] = G;
				c[ha + 264 >> 2] = H;
				c[ha + 516 >> 2] = (H | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[ha + 516 >> 2] = 0;
				break;
			} else {
				c[d >> 2] = o;
				c[ha + 264 >> 2] = n;
				c[ha + 516 >> 2] = (n | 0) != 0 ? 2 : 1;
			} while (0);
			b = ha + 520 | 0;
			L = ih(v | 0, w | 0, K | 0, L | 0) | 0;
			n = D;
			o = ih(I | 0, J | 0, e | 0, r | 0) | 0;
			o = Xg(L | 0, n | 0, o | 0, D | 0) | 0;
			n = D;
			do if (!((n | 0) > 0 | (n | 0) == 0 & o >>> 0 > 0)) if ((n | 0) < 0) {
				K = Xg(0, 0, o | 0, n | 0) | 0;
				L = D;
				c[b >> 2] = K;
				c[ha + 524 >> 2] = L;
				c[ha + 776 >> 2] = (L | 0) != 0 ? -2 : -1;
				break;
			} else {
				c[ha + 776 >> 2] = 0;
				break;
			} else {
				c[b >> 2] = o;
				c[ha + 524 >> 2] = n;
				c[ha + 776 >> 2] = (n | 0) != 0 ? 2 : 1;
			} while (0);
			Jf(O, fa, fa);
			Jf(P, ga, ga);
			Lf(N, O, P);
			bh(ja | 0, N | 0, 260) | 0;
			Jf(O, T, T);
			Jf(P, M, M);
			Lf(N, O, P);
			bh(ja + 260 | 0, N | 0, 260) | 0;
			Jf(O, Q, Q);
			Jf(P, y, y);
			Lf(N, O, P);
			bh(ja + 520 | 0, N | 0, 260) | 0;
			Jf(S, T, y);
			Jf(U, Q, M);
			Kf(R, S, U);
			bh(ia | 0, R | 0, 260) | 0;
			n = ia + 260 | 0;
			Jf(S, Q, ga);
			Jf(U, fa, y);
			Kf(R, S, U);
			bh(n | 0, R | 0, 260) | 0;
			o = ia + 520 | 0;
			Jf(S, fa, M);
			Jf(U, T, ga);
			Kf(R, S, U);
			bh(o | 0, R | 0, 260) | 0;
			Of(V, a, ia, ja);
			m = +Yf(+h[V >> 3], c[V + 8 >> 2] | 0);
			if (j) {
				Jf(Y, M, b);
				Jf(Z, y, d);
				Kf(X, Y, Z);
				bh(ia | 0, X | 0, 260) | 0;
				Jf(Y, y, ha);
				Jf(Z, ga, b);
				Kf(X, Y, Z);
				bh(n | 0, X | 0, 260) | 0;
				Jf(Y, ga, d);
				Jf(Z, M, ha);
				Kf(X, Y, Z);
				bh(o | 0, X | 0, 260) | 0;
				Of(W, a, ia, ja);
				h[f + 8 >> 3] = +Yf(+h[W >> 3], c[W + 8 >> 2] | 0) / m;
			}
			if (!(g | k)) {
				i = ka;
				return;
			}
			l = ia + 780 | 0;
			c[ia + 1036 >> 2] = 0;
			Jf($, T, b);
			Jf(aa, Q, d);
			Kf(_, $, aa);
			bh(ia | 0, _ | 0, 260) | 0;
			if (k) {
				Jf(ca, ia, ga);
				Lf(ba, l, ca);
				bh(l | 0, ba | 0, 260) | 0;
				Jf($, Q, ha);
				Jf(aa, fa, b);
				Kf(_, $, aa);
				bh(n | 0, _ | 0, 260) | 0;
				Jf(ca, n, M);
				Lf(ba, l, ca);
				bh(l | 0, ba | 0, 260) | 0;
				Jf($, fa, d);
				Jf(aa, T, ha);
				Kf(_, $, aa);
				bh(o | 0, _ | 0, 260) | 0;
				Jf(ca, o, y);
				Lf(ba, l, ca);
				bh(l | 0, ba | 0, 260) | 0;
			} else {
				Jf($, Q, ha);
				Jf(aa, fa, b);
				Kf(_, $, aa);
				bh(n | 0, _ | 0, 260) | 0;
				Jf($, fa, d);
				Jf(aa, T, ha);
				Kf(_, $, aa);
				bh(o | 0, _ | 0, 260) | 0;
			}
			if (g) {
				Of(da, a, ia, ja);
				h[f >> 3] = +Yf(+h[da >> 3], c[da + 8 >> 2] | 0) / m;
			}
			if (!k) {
				i = ka;
				return;
			}
			c[ja + 780 >> 2] = 1;
			c[ja + 1036 >> 2] = 1;
			Nf(ea, a, ia, ja);
			h[f + 16 >> 3] = +Yf(+h[ea >> 3], c[ea + 8 >> 2] | 0) / m;
			i = ka;
			return;
		}
		function Jf(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0;
			p = b + 256 | 0;
			e = c[p >> 2] | 0;
			if ((e | 0) != 0 ? (q = d + 256 | 0, f = c[q >> 2] | 0, (f | 0) != 0) : 0) {
				n = (e | 0) > -1 ? e : 0 - e | 0;
				l = (f | 0) > -1 ? f : 0 - f | 0;
				m = n + -1 + l | 0;
				m = m >>> 0 < 64 ? m : 64;
				o = a + 256 | 0;
				c[o >> 2] = m;
				if (m) {
					k = (n | 0) == 0;
					g = 0;
					f = 0;
					m = 0;
					do {
						if (k) {
							h = 0;
							e = 0;
						} else {
							h = 0;
							e = 0;
							j = 0;
							do {
								i = m - j | 0;
								if (i >>> 0 < l >>> 0) {
									r = ih(c[d + (i << 2) >> 2] | 0, 0, c[b + (j << 2) >> 2] | 0, 0) | 0;
									i = D;
									g = $g(r | 0, 0, g | 0, f | 0) | 0;
									f = D;
									h = $g(i | 0, 0, h | 0, e | 0) | 0;
									e = D;
								}
								j = j + 1 | 0;
							} while (m >>> 0 >= j >>> 0 & j >>> 0 < n >>> 0);
						}
						c[a + (m << 2) >> 2] = g;
						g = $g(f | 0, 0, h | 0, e | 0) | 0;
						f = D;
						m = m + 1 | 0;
						e = c[o >> 2] | 0;
					} while (m >>> 0 < e >>> 0);
					if (!((g | 0) == 0 & (f | 0) == 0 | (e | 0) == 64)) {
						c[a + (e << 2) >> 2] = g;
						e = (c[o >> 2] | 0) + 1 | 0;
						c[o >> 2] = e;
					}
				} else e = 0;
				if (!((c[p >> 2] | 0) > 0 ^ (c[q >> 2] | 0) > 0)) return;
				c[o >> 2] = 0 - e;
				return;
			}
			c[a + 256 >> 2] = 0;
			return;
		}
		function Kf(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0, l = 0, m = 0;
			l = b + 256 | 0;
			f = c[l >> 2] | 0;
			if (!f) {
				bh(a | 0, d | 0, 260) | 0;
				l = a + 256 | 0;
				c[l >> 2] = 0 - (c[l >> 2] | 0);
				return;
			}
			e = c[d + 256 >> 2] | 0;
			if (!e) {
				bh(a | 0, b | 0, 260) | 0;
				return;
			}
			g = (f | 0) > -1 ? f : 0 - f | 0;
			h = (e | 0) > -1 ? e : 0 - e | 0;
			if ((f | 0) > 0 ^ (e | 0) > 0) {
				f = d;
				e = g;
				d = h;
				while (1) if (e >>> 0 < d >>> 0) {
					j = d;
					k = f;
					d = e;
					e = j;
					f = b;
					b = k;
				} else {
					i = f;
					j = e;
					break;
				}
				k = a + 256 | 0;
				c[k >> 2] = j;
				if (!d) {
					f = 0;
					e = 0;
					d = 0;
				} else {
					f = 0;
					g = 0;
					h = 0;
					while (1) {
						e = c[i + (h << 2) >> 2] | 0;
						g = $g(c[b + (h << 2) >> 2] | 0, 0, f | 0, g | 0) | 0;
						g = $g(g | 0, D | 0, e | 0, 0) | 0;
						f = D;
						c[a + (h << 2) >> 2] = g;
						h = h + 1 | 0;
						if ((h | 0) == (d | 0)) {
							e = 0;
							break;
						} else g = 0;
					}
				}
				if (d >>> 0 < j >>> 0) while (1) {
					i = $g(c[b + (d << 2) >> 2] | 0, 0, f | 0, e | 0) | 0;
					f = D;
					c[a + (d << 2) >> 2] = i;
					d = d + 1 | 0;
					if ((d | 0) == (j | 0)) {
						e = 0;
						break;
					} else e = 0;
				}
				if (!((f | 0) == 0 & (e | 0) == 0) ? (m = c[k >> 2] | 0, (m | 0) != 64) : 0) {
					c[a + (m << 2) >> 2] = f;
					c[k >> 2] = (c[k >> 2] | 0) + 1;
				}
			} else Qf(a, b, g, d, h, 0);
			if ((c[l >> 2] | 0) >= 0) return;
			l = a + 256 | 0;
			c[l >> 2] = 0 - (c[l >> 2] | 0);
			return;
		}
		function Lf(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0, l = 0, m = 0;
			k = b + 256 | 0;
			f = c[k >> 2] | 0;
			if (!f) {
				bh(a | 0, d | 0, 260) | 0;
				return;
			}
			e = c[d + 256 >> 2] | 0;
			if (!e) {
				bh(a | 0, b | 0, 260) | 0;
				return;
			}
			g = (f | 0) > -1 ? f : 0 - f | 0;
			h = (e | 0) > -1 ? e : 0 - e | 0;
			if (!((f | 0) > 0 ^ (e | 0) > 0)) {
				f = d;
				e = g;
				d = h;
				while (1) if (e >>> 0 < d >>> 0) {
					i = d;
					j = f;
					d = e;
					e = i;
					f = b;
					b = j;
				} else {
					g = f;
					i = e;
					break;
				}
				j = a + 256 | 0;
				c[j >> 2] = i;
				if (!d) {
					f = 0;
					e = 0;
					d = 0;
				} else {
					f = 0;
					e = 0;
					h = 0;
					while (1) {
						m = c[g + (h << 2) >> 2] | 0;
						e = $g(c[b + (h << 2) >> 2] | 0, 0, f | 0, e | 0) | 0;
						e = $g(e | 0, D | 0, m | 0, 0) | 0;
						f = D;
						c[a + (h << 2) >> 2] = e;
						h = h + 1 | 0;
						if ((h | 0) == (d | 0)) {
							e = 0;
							break;
						} else e = 0;
					}
				}
				if (d >>> 0 < i >>> 0) while (1) {
					h = $g(c[b + (d << 2) >> 2] | 0, 0, f | 0, e | 0) | 0;
					f = D;
					c[a + (d << 2) >> 2] = h;
					d = d + 1 | 0;
					if ((d | 0) == (i | 0)) {
						e = 0;
						break;
					} else e = 0;
				}
				if (!((f | 0) == 0 & (e | 0) == 0) ? (l = c[j >> 2] | 0, (l | 0) != 64) : 0) {
					c[a + (l << 2) >> 2] = f;
					c[j >> 2] = (c[j >> 2] | 0) + 1;
				}
			} else Qf(a, b, g, d, h, 0);
			if ((c[k >> 2] | 0) >= 0) return;
			l = a + 256 | 0;
			c[l >> 2] = 0 - (c[l >> 2] | 0);
			return;
		}
		function Mf(a, b, d, e) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			var f = 0, g = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0;
			u = i;
			i = i + 1376 | 0;
			r = u + 48 | 0;
			s = u + 32 | 0;
			o = u + 1104 | 0;
			f = u + 844 | 0;
			j = u + 584 | 0;
			k = u + 324 | 0;
			l = u + 64 | 0;
			p = u + 16 | 0;
			q = u;
			Rf(r, b, d, e);
			m = d + 260 | 0;
			n = e + 260 | 0;
			Rf(s, b, m, n);
			g = +h[r >> 3];
			if (!(!(g < 0) ? !(+h[s >> 3] < 0) : 0)) t = 3;
			do if ((t | 0) == 3) {
				if (!(g > 0) ? !(+h[s >> 3] > 0) : 0) break;
				Jf(f, d, d);
				Jf(j, f, e);
				Jf(l, m, m);
				Jf(k, l, n);
				Kf(o, j, k);
				b = c[o + 256 >> 2] | 0;
				f = (b | 0) > -1 ? b : 0 - b | 0;
				if ((f | 0) == 2) {
					g = +((c[o + 4 >> 2] | 0) >>> 0) * 4294967296 + +((c[o >> 2] | 0) >>> 0);
					f = 0;
					t = 10;
				} else if ((f | 0) == 1) {
					g = +((c[o >> 2] | 0) >>> 0);
					f = 0;
					t = 10;
				} else if (!f) {
					g = 0;
					f = 0;
				} else {
					g = +((c[o + (f + -3 << 2) >> 2] | 0) >>> 0) + (+((c[o + (f + -1 << 2) >> 2] | 0) >>> 0) * 4294967296 + +((c[o + (f + -2 << 2) >> 2] | 0) >>> 0)) * 4294967296;
					f = (f << 5) + -96 | 0;
					t = 10;
				}
				if ((t | 0) == 10) if ((b | 0) < 0) g = -g;
				o = p + 8 | 0;
				g = +Sg(g, o);
				h[p >> 3] = g;
				e = (c[o >> 2] | 0) + f | 0;
				c[o >> 2] = e;
				Tf(q, r, s);
				e = e - (c[q + 8 >> 2] | 0) | 0;
				o = a + 8 | 0;
				h[a >> 3] = +Sg(g / +h[q >> 3], o);
				c[o >> 2] = e + (c[o >> 2] | 0);
				i = u;
				return;
			} while (0);
			Sf(a, r, s);
			i = u;
			return;
		}
		function Nf(a, b, d, e) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			var f = 0, g = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0, v = 0, w = 0, x = 0, y = 0, z = 0, A = 0, B = 0, C = 0, D = 0, E = 0, F = 0, G = 0, H = 0;
			H = i;
			i = i + 4752 | 0;
			F = H + 4484 | 0;
			D = H + 48 | 0;
			E = H + 32 | 0;
			f = H + 4224 | 0;
			g = H + 3964 | 0;
			t = H + 3704 | 0;
			w = H + 3444 | 0;
			x = H + 3184 | 0;
			y = H + 2924 | 0;
			z = H + 2664 | 0;
			A = H + 2404 | 0;
			B = H + 2144 | 0;
			C = H + 1884 | 0;
			j = H + 1624 | 0;
			k = H + 1364 | 0;
			l = H + 1104 | 0;
			m = H + 844 | 0;
			n = H + 584 | 0;
			o = H + 324 | 0;
			p = H + 64 | 0;
			q = H + 16 | 0;
			r = H;
			Mf(D, b, d, e);
			s = d + 520 | 0;
			u = e + 520 | 0;
			Mf(E, b, s, u);
			v = +h[D >> 3];
			if (!(!(v < 0) ? !(+h[E >> 3] < 0) : 0)) G = 3;
			do if ((G | 0) == 3) {
				if (!(v > 0) ? !(+h[E >> 3] > 0) : 0) break;
				Jf(g, d, d);
				Jf(t, g, e);
				G = d + 260 | 0;
				Jf(x, G, G);
				g = e + 260 | 0;
				Jf(w, x, g);
				Lf(y, t, w);
				Jf(A, s, s);
				Jf(z, A, u);
				Kf(B, y, z);
				z = d + 780 | 0;
				Jf(j, z, z);
				A = e + 780 | 0;
				Jf(C, j, A);
				Kf(f, B, C);
				bh(b | 0, f | 0, 260) | 0;
				C = b + 1300 | 0;
				c[C >> 2] = 1;
				c[b + 1556 >> 2] = 1;
				Jf(l, d, G);
				c[F >> 2] = 2;
				c[F + 256 >> 2] = 1;
				Jf(k, l, F);
				bh(b + 260 | 0, k | 0, 260) | 0;
				Jf(m, e, g);
				bh(b + 1560 | 0, m | 0, 260) | 0;
				Jf(o, s, z);
				c[F >> 2] = 2;
				c[F + 256 >> 2] = -1;
				Jf(n, o, F);
				bh(b + 520 | 0, n | 0, 260) | 0;
				Jf(p, u, A);
				bh(b + 1820 | 0, p | 0, 260) | 0;
				Of(q, b, b, C);
				Tf(r, D, E);
				C = (c[q + 8 >> 2] | 0) - (c[r + 8 >> 2] | 0) | 0;
				d = a + 8 | 0;
				h[a >> 3] = +Sg(+h[q >> 3] / +h[r >> 3], d);
				c[d >> 2] = C + (c[d >> 2] | 0);
				i = H;
				return;
			} while (0);
			Sf(a, D, E);
			i = H;
			return;
		}
		function Of(a, b, d, e) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			var f = 0, g = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0, v = 0, w = 0, x = 0, y = 0, z = 0, A = 0, B = 0, C = 0;
			B = i;
			i = i + 3184 | 0;
			z = B + 2924 | 0;
			x = B + 48 | 0;
			y = B + 32 | 0;
			f = B + 2664 | 0;
			g = B + 2404 | 0;
			p = B + 2144 | 0;
			q = B + 1884 | 0;
			r = B + 1624 | 0;
			s = B + 1364 | 0;
			t = B + 1104 | 0;
			u = B + 844 | 0;
			v = B + 584 | 0;
			w = B + 324 | 0;
			j = B + 64 | 0;
			k = B + 16 | 0;
			l = B;
			Mf(x, b, d, e);
			m = d + 520 | 0;
			n = e + 520 | 0;
			Rf(y, b, m, n);
			o = +h[x >> 3];
			if (!(!(o < 0) ? !(+h[y >> 3] < 0) : 0)) A = 3;
			do if ((A | 0) == 3) {
				if (!(o > 0) ? !(+h[y >> 3] > 0) : 0) break;
				A = b + 780 | 0;
				Jf(g, d, d);
				Jf(p, g, e);
				C = d + 260 | 0;
				Jf(r, C, C);
				g = e + 260 | 0;
				Jf(q, r, g);
				Lf(s, p, q);
				Jf(u, m, m);
				Jf(t, u, n);
				Kf(f, s, t);
				bh(A | 0, f | 0, 260) | 0;
				u = b + 2080 | 0;
				c[u >> 2] = 1;
				c[b + 2336 >> 2] = 1;
				Jf(w, d, C);
				c[z >> 2] = 2;
				c[z + 256 >> 2] = 1;
				Jf(v, w, z);
				bh(b + 1040 | 0, v | 0, 260) | 0;
				Jf(j, e, g);
				bh(b + 2340 | 0, j | 0, 260) | 0;
				Mf(k, b, A, u);
				Tf(l, x, y);
				z = (c[k + 8 >> 2] | 0) - (c[l + 8 >> 2] | 0) | 0;
				b = a + 8 | 0;
				h[a >> 3] = +Sg(+h[k >> 3] / +h[l >> 3], b);
				c[b >> 2] = z + (c[b >> 2] | 0);
				i = B;
				return;
			} while (0);
			Sf(a, x, y);
			i = B;
			return;
		}
		function Pf(a, b, d, e) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			var f = 0, g = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0, v = 0, w = 0, x = 0, y = 0, z = 0, A = 0, B = 0, C = 0, D = 0, E = 0, F = 0, G = 0, H = 0, I = 0, J = 0, K = 0, L = 0, M = 0, N = 0, O = 0, Q = 0, R = 0, S = 0, T = 0, U = 0, V = 0, W = 0, X = 0, Y = 0, Z = 0, _ = 0, $ = 0, aa = 0, ba = 0, ca = 0, da = 0, ea = 0, fa = 0, ga = 0, ha = 0, ia = 0, ja = 0, ka = 0, la = 0, ma = 0, na = 0, oa = 0;
			na = i;
			i = i + 11680 | 0;
			ma = na + 11408 | 0;
			ka = na + 10368 | 0;
			la = na + 9328 | 0;
			J = na + 208 | 0;
			L = na + 192 | 0;
			q = na + 176 | 0;
			r = na + 160 | 0;
			p = na + 144 | 0;
			C = na + 9064 | 0;
			D = na + 8804 | 0;
			E = na + 8544 | 0;
			F = na + 8284 | 0;
			G = na + 8024 | 0;
			H = na + 7764 | 0;
			I = na + 7504 | 0;
			s = na + 7244 | 0;
			t = na + 6984 | 0;
			u = na + 6724 | 0;
			v = na + 6464 | 0;
			w = na + 6204 | 0;
			x = na + 5944 | 0;
			y = na + 5684 | 0;
			z = na + 5424 | 0;
			K = na + 128 | 0;
			A = na + 112 | 0;
			ja = na + 96 | 0;
			f = na + 80 | 0;
			B = na + 64 | 0;
			o = na + 48 | 0;
			ha = na + 32 | 0;
			M = na + 5164 | 0;
			N = na + 4904 | 0;
			O = na + 4644 | 0;
			Q = na + 4384 | 0;
			R = na + 4124 | 0;
			S = na + 3864 | 0;
			T = na + 3604 | 0;
			U = na + 3344 | 0;
			V = na + 3084 | 0;
			W = na + 2824 | 0;
			X = na + 2564 | 0;
			Y = na + 2304 | 0;
			Z = na + 2044 | 0;
			_ = na + 1784 | 0;
			$ = na + 1524 | 0;
			aa = na + 1264 | 0;
			ba = na + 1004 | 0;
			ca = na + 744 | 0;
			da = na + 484 | 0;
			ea = na + 224 | 0;
			ia = na + 16 | 0;
			fa = na;
			ga = d + 780 | 0;
			if (!(c[d + 1036 >> 2] | 0)) {
				Mf(J, b, d, e);
				c[ka >> 2] = 1;
				c[ka + 256 >> 2] = 1;
				j = e + 260 | 0;
				Jf(la, e, j);
				k = ka + 260 | 0;
				l = e + 520 | 0;
				bh(k | 0, l | 0, 260) | 0;
				m = la + 260 | 0;
				c[m >> 2] = 1;
				c[la + 516 >> 2] = 1;
				n = d + 520 | 0;
				o = e + 780 | 0;
				Rf(q, b, n, o);
				Mf(p, b, ka, la);
				g = +h[p >> 3];
				f = c[p + 8 >> 2] | 0;
				if (f & 1) {
					f = f + -1 | 0;
					g = g * 2;
				}
				aa = r + 8 | 0;
				g = +Sg(+P(+g), aa);
				h[r >> 3] = g;
				$ = (c[aa >> 2] | 0) + (f >> 1) | 0;
				c[aa >> 2] = $;
				$ = (c[q + 8 >> 2] | 0) + $ | 0;
				aa = L + 8 | 0;
				g = +Sg(+h[q >> 3] * g, aa);
				h[L >> 3] = g;
				c[aa >> 2] = $ + (c[aa >> 2] | 0);
				oa = +h[J >> 3];
				if (oa < 0 | g < 0 ? oa > 0 | g > 0 : 0) {
					Jf(D, d, d);
					Jf(E, D, e);
					$ = d + 260 | 0;
					Jf(G, $, $);
					Jf(F, G, j);
					Lf(H, E, F);
					Jf(s, n, n);
					Jf(t, s, o);
					Jf(I, t, l);
					Kf(C, H, I);
					bh(ka | 0, C | 0, 260) | 0;
					c[la >> 2] = 1;
					c[la + 256 >> 2] = 1;
					Jf(v, d, $);
					c[ma >> 2] = 2;
					c[ma + 256 >> 2] = 1;
					Jf(w, v, ma);
					Jf(y, n, n);
					Jf(x, y, o);
					Kf(u, w, x);
					bh(k | 0, u | 0, 260) | 0;
					Jf(z, e, j);
					bh(m | 0, z | 0, 260) | 0;
					Mf(K, b, ka, la);
					Tf(A, J, L);
					$ = (c[K + 8 >> 2] | 0) - (c[A + 8 >> 2] | 0) | 0;
					aa = a + 8 | 0;
					h[a >> 3] = +Sg(+h[K >> 3] / +h[A >> 3], aa);
					c[aa >> 2] = $ + (c[aa >> 2] | 0);
					i = na;
					return;
				}
				Sf(a, J, L);
				i = na;
				return;
			} else {
				c[ka >> 2] = 1;
				c[ka + 256 >> 2] = 1;
				j = e + 260 | 0;
				Jf(la, e, j);
				p = ka + 260 | 0;
				m = e + 520 | 0;
				bh(p | 0, m | 0, 260) | 0;
				n = la + 260 | 0;
				c[n >> 2] = 1;
				c[la + 516 >> 2] = 1;
				l = d + 520 | 0;
				k = e + 780 | 0;
				Rf(f, b, l, k);
				Mf(o, b, ka, la);
				g = +h[o >> 3];
				o = c[o + 8 >> 2] | 0;
				if (o & 1) {
					o = o + -1 | 0;
					g = g * 2;
				}
				K = B + 8 | 0;
				g = +Sg(+P(+g), K);
				h[B >> 3] = g;
				L = (c[K >> 2] | 0) + (o >> 1) | 0;
				c[K >> 2] = L;
				L = (c[f + 8 >> 2] | 0) + L | 0;
				o = ja + 8 | 0;
				g = +Sg(+h[f >> 3] * g, o);
				h[ja >> 3] = g;
				c[o >> 2] = L + (c[o >> 2] | 0);
				bh(ka | 0, d | 0, 260) | 0;
				bh(la | 0, e | 0, 260) | 0;
				o = d + 260 | 0;
				bh(p | 0, o | 0, 260) | 0;
				bh(n | 0, j | 0, 260) | 0;
				f = ka + 520 | 0;
				bh(f | 0, ga | 0, 260) | 0;
				c[la + 520 >> 2] = 1;
				c[la + 776 >> 2] = 1;
				Of(ha, b, ka, la);
				oa = +h[ha >> 3];
				if (oa < 0 | g < 0 ? oa > 0 | g > 0 : 0) {
					Jf(M, ga, d);
					c[ma >> 2] = 2;
					c[ma + 256 >> 2] = 1;
					Jf(ka, M, ma);
					Jf(O, ga, o);
					c[ma >> 2] = 2;
					c[ma + 256 >> 2] = 1;
					Jf(N, O, ma);
					bh(p | 0, N | 0, 260) | 0;
					Jf(R, d, d);
					Jf(S, R, e);
					Jf(U, o, o);
					Jf(T, U, j);
					Lf(V, S, T);
					Jf(W, ga, ga);
					Lf(X, V, W);
					Jf(Z, l, l);
					Jf(_, Z, m);
					Jf(Y, _, k);
					Kf(Q, X, Y);
					bh(f | 0, Q | 0, 260) | 0;
					Jf(aa, d, o);
					c[ma >> 2] = 2;
					c[ma + 256 >> 2] = 1;
					Jf(ba, aa, ma);
					Jf(da, l, l);
					Jf(ca, da, k);
					Kf($, ba, ca);
					bh(ka + 780 | 0, $ | 0, 260) | 0;
					Jf(ea, e, j);
					bh(la + 780 | 0, ea | 0, 260) | 0;
					Uf(ia, b, ka, la);
					Tf(fa, ha, ja);
					$ = (c[ia + 8 >> 2] | 0) - (c[fa + 8 >> 2] | 0) | 0;
					aa = a + 8 | 0;
					h[a >> 3] = +Sg(+h[ia >> 3] / +h[fa >> 3], aa);
					c[aa >> 2] = $ + (c[aa >> 2] | 0);
					i = na;
					return;
				}
				Sf(a, ha, ja);
				i = na;
				return;
			}
		}
		function Qf(a, b, d, e, f, g) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			g = g | 0;
			var h = 0, i = 0, j = 0, k = 0, l = 0;
			if (d >>> 0 < f >>> 0) {
				Qf(a, e, f, b, d, 1);
				b = a + 256 | 0;
				c[b >> 2] = 0 - (c[b >> 2] | 0);
				return;
			}
			do if ((d | 0) != (f | 0) | g) {
				i = a + 256 | 0;
				c[i >> 2] = d + -1;
				if (!f) {
					f = 0;
					h = 0;
				} else {
					j = d;
					k = i;
					l = 12;
				}
			} else {
				g = d;
				do {
					h = g;
					g = g + -1 | 0;
					f = c[b + (g << 2) >> 2] | 0;
					i = c[e + (g << 2) >> 2] | 0;
					if (f >>> 0 < i >>> 0) {
						l = 5;
						break;
					}
					if (f >>> 0 > i >>> 0) {
						j = h;
						l = 8;
						break;
					}
				} while ((g | 0) != 0);
				if ((l | 0) == 5) {
					Qf(a, e, h, b, h, 1);
					b = a + 256 | 0;
					c[b >> 2] = 0 - (c[b >> 2] | 0);
					return;
				}
				if ((l | 0) == 8 ? (j | 0) != 0 : 0) {
					k = a + 256 | 0;
					c[k >> 2] = j + -1;
					f = j;
					l = 12;
					break;
				}
				c[a + 256 >> 2] = 0;
				return;
			} while (0);
			if ((l | 0) == 12) {
				h = 0;
				d = 0;
				do {
					i = b + (d << 2) | 0;
					g = e + (d << 2) | 0;
					c[a + (d << 2) >> 2] = (c[i >> 2] | 0) + (h << 31 >> 31) - (c[g >> 2] | 0);
					i = c[i >> 2] | 0;
					g = c[g >> 2] | 0;
					if (i >>> 0 < g >>> 0) h = 1; else h = h & (i | 0) == (g | 0);
					d = d + 1 | 0;
				} while ((d | 0) != (f | 0));
				d = j;
				i = k;
			}
			if (f >>> 0 < d >>> 0) {
				g = h;
				while (1) {
					h = b + (f << 2) | 0;
					c[a + (f << 2) >> 2] = (c[h >> 2] | 0) - (g & 1);
					f = f + 1 | 0;
					if ((f | 0) == (d | 0)) break; else g = g & (c[h >> 2] | 0) == 0;
				}
			}
			h = c[i >> 2] | 0;
			if (!(c[a + (h << 2) >> 2] | 0)) return;
			c[i >> 2] = h + 1;
			return;
		}
		function Rf(a, b, d, e) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			var f = 0, g = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0;
			o = i;
			i = i + 48 | 0;
			j = o + 32 | 0;
			l = o + 16 | 0;
			n = o;
			g = c[d + 256 >> 2] | 0;
			b = (g | 0) > -1 ? g : 0 - g | 0;
			if (!b) {
				f = 0;
				b = 0;
			} else if ((b | 0) == 2) {
				f = +((c[d + 4 >> 2] | 0) >>> 0) * 4294967296 + +((c[d >> 2] | 0) >>> 0);
				b = 0;
				m = 5;
			} else if ((b | 0) == 1) {
				f = +((c[d >> 2] | 0) >>> 0);
				b = 0;
				m = 5;
			} else {
				f = +((c[d + (b + -3 << 2) >> 2] | 0) >>> 0) + (+((c[d + (b + -1 << 2) >> 2] | 0) >>> 0) * 4294967296 + +((c[d + (b + -2 << 2) >> 2] | 0) >>> 0)) * 4294967296;
				b = (b << 5) + -96 | 0;
				m = 5;
			}
			if ((m | 0) == 5) if ((g | 0) < 0) f = -f;
			g = j + 8 | 0;
			k = +Sg(f, g);
			h[j >> 3] = k;
			j = (c[g >> 2] | 0) + b | 0;
			c[g >> 2] = j;
			g = c[e + 256 >> 2] | 0;
			b = (g | 0) > -1 ? g : 0 - g | 0;
			if (!b) {
				f = 0;
				b = 0;
			} else if ((b | 0) == 2) {
				f = +((c[e + 4 >> 2] | 0) >>> 0) * 4294967296 + +((c[e >> 2] | 0) >>> 0);
				b = 0;
				m = 11;
			} else if ((b | 0) == 1) {
				f = +((c[e >> 2] | 0) >>> 0);
				b = 0;
				m = 11;
			} else {
				f = +((c[e + (b + -3 << 2) >> 2] | 0) >>> 0) + (+((c[e + (b + -1 << 2) >> 2] | 0) >>> 0) * 4294967296 + +((c[e + (b + -2 << 2) >> 2] | 0) >>> 0)) * 4294967296;
				b = (b << 5) + -96 | 0;
				m = 11;
			}
			if ((m | 0) == 11) if ((g | 0) < 0) f = -f;
			d = l + 8 | 0;
			f = +Sg(f, d);
			h[l >> 3] = f;
			b = (c[d >> 2] | 0) + b | 0;
			c[d >> 2] = b;
			if (!(b & 1)) {
				d = b;
				f = +P(+f);
				d = d >> 1;
				b = n + 8 | 0;
				f = +Sg(f, b);
				h[n >> 3] = f;
				b = c[b >> 2] | 0;
				d = b + d | 0;
				f = k * f;
				d = j + d | 0;
				b = a + 8 | 0;
				f = +Sg(f, b);
				h[a >> 3] = f;
				a = c[b >> 2] | 0;
				a = d + a | 0;
				c[b >> 2] = a;
				i = o;
				return;
			}
			d = b + -1 | 0;
			f = f * 2;
			f = +P(+f);
			d = d >> 1;
			b = n + 8 | 0;
			f = +Sg(f, b);
			h[n >> 3] = f;
			b = c[b >> 2] | 0;
			d = b + d | 0;
			f = k * f;
			d = j + d | 0;
			b = a + 8 | 0;
			f = +Sg(f, b);
			h[a >> 3] = f;
			a = c[b >> 2] | 0;
			a = d + a | 0;
			c[b >> 2] = a;
			i = o;
			return;
		}
		function Sf(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, i = 0;
			f = +h[b >> 3];
			if (!(f == 0) ? (g = c[d + 8 >> 2] | 0, i = c[b + 8 >> 2] | 0, (g | 0) <= (i + 54 | 0)) : 0) {
				e = +h[d >> 3];
				if ((i | 0) > (g + 54 | 0) | e == 0) {
					c[a + 0 >> 2] = c[b + 0 >> 2];
					c[a + 4 >> 2] = c[b + 4 >> 2];
					c[a + 8 >> 2] = c[b + 8 >> 2];
					c[a + 12 >> 2] = c[b + 12 >> 2];
					return;
				}
				if ((i | 0) < (g | 0)) {
					d = a + 8 | 0;
					h[a >> 3] = +Sg(f + +Yf(e, g - i | 0), d);
					c[d >> 2] = (c[d >> 2] | 0) + i;
					return;
				} else {
					d = a + 8 | 0;
					h[a >> 3] = +Sg(e + +Yf(f, i - g | 0), d);
					c[d >> 2] = (c[d >> 2] | 0) + g;
					return;
				}
			}
			c[a + 0 >> 2] = c[d + 0 >> 2];
			c[a + 4 >> 2] = c[d + 4 >> 2];
			c[a + 8 >> 2] = c[d + 8 >> 2];
			c[a + 12 >> 2] = c[d + 12 >> 2];
			return;
		}
		function Tf(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, i = 0;
			g = +h[b >> 3];
			f = c[d + 8 >> 2] | 0;
			if (!(g == 0) ? (i = c[b + 8 >> 2] | 0, (f | 0) <= (i + 54 | 0)) : 0) {
				e = +h[d >> 3];
				if ((i | 0) > (f + 54 | 0) | e == 0) {
					c[a + 0 >> 2] = c[b + 0 >> 2];
					c[a + 4 >> 2] = c[b + 4 >> 2];
					c[a + 8 >> 2] = c[b + 8 >> 2];
					c[a + 12 >> 2] = c[b + 12 >> 2];
					return;
				}
				if ((i | 0) < (f | 0)) {
					d = a + 8 | 0;
					h[a >> 3] = +Sg(g + +Yf(-e, f - i | 0), d);
					c[d >> 2] = (c[d >> 2] | 0) + i;
					return;
				} else {
					d = a + 8 | 0;
					h[a >> 3] = +Sg(+Yf(g, i - f | 0) - e, d);
					c[d >> 2] = (c[d >> 2] | 0) + f;
					return;
				}
			}
			i = a + 8 | 0;
			h[a >> 3] = +Sg(- +h[d >> 3], i);
			c[i >> 2] = (c[i >> 2] | 0) + f;
			return;
		}
		function Uf(a, b, d, e) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			var f = 0, g = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0, v = 0, w = 0, x = 0, y = 0, z = 0, A = 0, B = 0, C = 0, D = 0, E = 0, F = 0, G = 0;
			G = i;
			i = i + 5280 | 0;
			E = G + 5008 | 0;
			z = G + 4488 | 0;
			A = G + 3968 | 0;
			B = G + 48 | 0;
			D = G + 32 | 0;
			f = G + 3704 | 0;
			g = G + 3444 | 0;
			r = G + 3184 | 0;
			s = G + 2924 | 0;
			t = G + 2664 | 0;
			u = G + 2404 | 0;
			v = G + 2144 | 0;
			w = G + 1884 | 0;
			x = G + 1624 | 0;
			y = G + 1364 | 0;
			j = G + 1104 | 0;
			k = G + 844 | 0;
			l = G + 584 | 0;
			m = G + 324 | 0;
			n = G + 64 | 0;
			C = G + 16 | 0;
			o = G;
			Mf(B, b, d, e);
			p = d + 520 | 0;
			Mf(D, b, p, e + 520 | 0);
			q = +h[B >> 3];
			if (!(!(q < 0) ? !(+h[D >> 3] < 0) : 0)) F = 3;
			do if ((F | 0) == 3) {
				if (!(q > 0) ? !(+h[D >> 3] > 0) : 0) break;
				Jf(g, d, d);
				Jf(r, g, e);
				g = d + 260 | 0;
				Jf(t, g, g);
				F = e + 260 | 0;
				Jf(s, t, F);
				Lf(u, r, s);
				Jf(v, p, p);
				Kf(w, u, v);
				v = d + 780 | 0;
				Jf(y, v, v);
				Jf(j, y, e);
				Jf(x, j, F);
				Kf(f, w, x);
				bh(z | 0, f | 0, 260) | 0;
				c[A >> 2] = 1;
				c[A + 256 >> 2] = 1;
				Jf(l, d, g);
				Jf(m, p, v);
				Kf(n, l, m);
				c[E >> 2] = 2;
				c[E + 256 >> 2] = 1;
				Jf(k, n, E);
				bh(z + 260 | 0, k | 0, 260) | 0;
				bh(A + 260 | 0, e + 780 | 0, 260) | 0;
				Mf(C, b, z, A);
				Tf(o, B, D);
				z = (c[C + 8 >> 2] | 0) - (c[o + 8 >> 2] | 0) | 0;
				A = a + 8 | 0;
				h[a >> 3] = +Sg(+h[C >> 3] / +h[o >> 3], A);
				c[A >> 2] = z + (c[A >> 2] | 0);
				i = G;
				return;
			} while (0);
			Sf(a, B, D);
			i = G;
			return;
		}
		function Vf(a) {
			a = a | 0;
			return Zf(c[a + 4 >> 2] | 0) | 0;
		}
		function Wf(a) {
			a = a | 0;
			Yb(5200, 2488);
			Ya(5232, 2496, 1, 1, 0);
			vb(5248, 2504, 1, -128, 127);
			vb(5280, 2512, 1, -128, 127);
			vb(5264, 2528, 1, 0, 255);
			vb(5296, 2544, 2, -32768, 32767);
			vb(5312, 2552, 2, 0, 65535);
			vb(5328, 2568, 4, -2147483648, 2147483647);
			vb(5344, 2576, 4, 0, -1);
			vb(5360, 2592, 4, -2147483648, 2147483647);
			vb(5376, 2600, 4, 0, -1);
			hc(5392, 2616, 4);
			hc(5408, 2624, 8);
			Ja(4152, 2632);
			Ja(4064, 2648);
			ac(3976, 4, 2688);
			ab(1376, 2704);
			Tb(3856, 0, 2720);
			Tb(3816, 0, 2752);
			Tb(3776, 1, 2792);
			Tb(3736, 2, 2832);
			Tb(3696, 3, 2864);
			Tb(3656, 4, 2904);
			Tb(3616, 5, 2936);
			Tb(3576, 4, 2976);
			Tb(3536, 5, 3008);
			Tb(3816, 0, 3048);
			Tb(3776, 1, 3080);
			Tb(3736, 2, 3120);
			Tb(3696, 3, 3160);
			Tb(3656, 4, 3200);
			Tb(3616, 5, 3240);
			Tb(3496, 6, 3280);
			Tb(3456, 7, 3312);
			Tb(3416, 7, 3344);
			return;
		}
		function Xf() {
			Wf(0);
			return;
		}
		function Yf(a, b) {
			a = +a;
			b = b | 0;
			return + +Tg(a, b);
		}
		function Zf(a) {
			a = a | 0;
			var b = 0, c = 0;
			b = (_g(a | 0) | 0) + 1 | 0;
			c = Qg(b) | 0;
			if (!c) {
				b = 0;
				return b | 0;
			}
			bh(c | 0, a | 0, b | 0) | 0;
			b = c;
			return b | 0;
		}
		function _f(a, b) {
			a = a | 0;
			b = b | 0;
			var d = 0;
			d = i;
			i = i + 16 | 0;
			c[d >> 2] = b;
			b = c[n >> 2] | 0;
			ub(b | 0, a | 0, d | 0) | 0;
			Mb(10, b | 0) | 0;
			Nb();
		}
		function $f(a) {
			a = a | 0;
			ya(4384, 4408, 303, 4360);
		}
		function ag() {
			var a = 0, b = 0;
			a = i;
			i = i + 16 | 0;
			if (!(cb(4496, 2) | 0)) {
				b = Ab(c[1122] | 0) | 0;
				i = a;
				return b | 0;
			} else _f(4504, a);
			return 0;
		}
		function bg(a) {
			a = a | 0;
			var b = 0;
			b = (a | 0) == 0 ? 1 : a;
			while (1) {
				a = Qg(b) | 0;
				if (a) {
					b = 6;
					break;
				}
				a = ig() | 0;
				if (!a) {
					b = 5;
					break;
				}
				Dc[a & 3]();
			}
			if ((b | 0) == 5) {
				a = wb(4) | 0;
				c[a >> 2] = 4680;
				oc(a | 0, 4728, 1);
			} else if ((b | 0) == 6) return a | 0;
			return 0;
		}
		function cg(a) {
			a = a | 0;
			Rg(a);
			return;
		}
		function dg(a) {
			a = a | 0;
			return;
		}
		function eg(a) {
			a = a | 0;
			cg(a);
			return;
		}
		function fg(a) {
			a = a | 0;
			return 4696;
		}
		function gg(a) {
			a = a | 0;
			var b = 0;
			b = i;
			i = i + 16 | 0;
			Dc[a & 3]();
			_f(4744, b);
		}
		function hg() {
			var a = 0, b = 0;
			a = ag() | 0;
			if (((a | 0) != 0 ? (b = c[a >> 2] | 0, (b | 0) != 0) : 0) ? (a = b + 48 | 0, (c[a >> 2] & -256 | 0) == 1126902528 ? (c[a + 4 >> 2] | 0) == 1129074247 : 0) : 0) gg(c[b + 12 >> 2] | 0);
			a = c[1044] | 0;
			c[1044] = a + 0;
			gg(a);
		}
		function ig() {
			var a = 0;
			a = c[1196] | 0;
			c[1196] = a + 0;
			return a | 0;
		}
		function jg(a) {
			a = a | 0;
			return;
		}
		function kg(a) {
			a = a | 0;
			return;
		}
		function lg(a) {
			a = a | 0;
			return;
		}
		function mg(a) {
			a = a | 0;
			return;
		}
		function ng(a) {
			a = a | 0;
			return;
		}
		function og(a) {
			a = a | 0;
			cg(a);
			return;
		}
		function pg(a) {
			a = a | 0;
			cg(a);
			return;
		}
		function qg(a) {
			a = a | 0;
			cg(a);
			return;
		}
		function rg(a) {
			a = a | 0;
			cg(a);
			return;
		}
		function sg(a) {
			a = a | 0;
			cg(a);
			return;
		}
		function tg(a, b, c) {
			a = a | 0;
			b = b | 0;
			c = c | 0;
			return (a | 0) == (b | 0) | 0;
		}
		function ug(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, h = 0;
			h = i;
			i = i + 64 | 0;
			g = h;
			if ((a | 0) != (b | 0)) if ((b | 0) != 0 ? (f = Bg(b, 4880, 4936, 0) | 0, (f | 0) != 0) : 0) {
				b = g + 0 | 0;
				e = b + 56 | 0;
				do {
					c[b >> 2] = 0;
					b = b + 4 | 0;
				} while ((b | 0) < (e | 0));
				c[g >> 2] = f;
				c[g + 8 >> 2] = a;
				c[g + 12 >> 2] = -1;
				c[g + 48 >> 2] = 1;
				Hc[c[(c[f >> 2] | 0) + 28 >> 2] & 7](f, g, c[d >> 2] | 0, 1);
				if ((c[g + 24 >> 2] | 0) == 1) {
					c[d >> 2] = c[g + 16 >> 2];
					b = 1;
				} else b = 0;
			} else b = 0; else b = 1;
			i = h;
			return b | 0;
		}
		function vg(b, d, e, f) {
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			var g = 0;
			b = d + 16 | 0;
			g = c[b >> 2] | 0;
			do if (g) {
				if ((g | 0) != (e | 0)) {
					b = d + 36 | 0;
					c[b >> 2] = (c[b >> 2] | 0) + 1;
					c[d + 24 >> 2] = 2;
					a[d + 54 >> 0] = 1;
					break;
				}
				b = d + 24 | 0;
				if ((c[b >> 2] | 0) == 2) c[b >> 2] = f;
			} else {
				c[b >> 2] = e;
				c[d + 24 >> 2] = f;
				c[d + 36 >> 2] = 1;
			} while (0);
			return;
		}
		function wg(a, b, d, e) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			if ((a | 0) == (c[b + 8 >> 2] | 0)) vg(0, b, d, e);
			return;
		}
		function xg(a, b, d, e) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			if ((a | 0) == (c[b + 8 >> 2] | 0)) vg(0, b, d, e); else {
				a = c[a + 8 >> 2] | 0;
				Hc[c[(c[a >> 2] | 0) + 28 >> 2] & 7](a, b, d, e);
			}
			return;
		}
		function yg(a, b, d, e) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			var f = 0, g = 0;
			g = c[a + 4 >> 2] | 0;
			f = g >> 8;
			if (g & 1) f = c[(c[d >> 2] | 0) + f >> 2] | 0;
			a = c[a >> 2] | 0;
			Hc[c[(c[a >> 2] | 0) + 28 >> 2] & 7](a, b, d + f | 0, (g & 2 | 0) != 0 ? e : 2);
			return;
		}
		function zg(b, d, e, f) {
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			var g = 0, h = 0;
			a: do if ((b | 0) != (c[d + 8 >> 2] | 0)) {
				h = c[b + 12 >> 2] | 0;
				g = b + (h << 3) + 16 | 0;
				yg(b + 16 | 0, d, e, f);
				if ((h | 0) > 1) {
					h = d + 54 | 0;
					b = b + 24 | 0;
					do {
						yg(b, d, e, f);
						if (a[h >> 0] | 0) break a;
						b = b + 8 | 0;
					} while (b >>> 0 < g >>> 0);
				}
			} else vg(0, d, e, f); while (0);
			return;
		}
		function Ag(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, h = 0, j = 0, k = 0;
			k = i;
			i = i + 64 | 0;
			j = k;
			c[d >> 2] = c[c[d >> 2] >> 2];
			if (!((a | 0) == (b | 0) | (b | 0) == 5216)) if (((b | 0) != 0 ? (e = Bg(b, 4880, 5048, 0) | 0,
				(e | 0) != 0) : 0) ? (c[e + 8 >> 2] & ~c[a + 8 >> 2] | 0) == 0 : 0) {
				b = c[a + 12 >> 2] | 0;
				a = e + 12 | 0;
				if (!((b | 0) == 5200 ? 1 : (b | 0) == (c[a >> 2] | 0))) if ((((b | 0) != 0 ? (g = Bg(b, 4880, 4936, 0) | 0,
					(g | 0) != 0) : 0) ? (f = c[a >> 2] | 0, (f | 0) != 0) : 0) ? (h = Bg(f, 4880, 4936, 0) | 0,
						(h | 0) != 0) : 0) {
					b = j + 0 | 0;
					a = b + 56 | 0;
					do {
						c[b >> 2] = 0;
						b = b + 4 | 0;
					} while ((b | 0) < (a | 0));
					c[j >> 2] = h;
					c[j + 8 >> 2] = g;
					c[j + 12 >> 2] = -1;
					c[j + 48 >> 2] = 1;
					Hc[c[(c[h >> 2] | 0) + 28 >> 2] & 7](h, j, c[d >> 2] | 0, 1);
					if ((c[j + 24 >> 2] | 0) == 1) {
						c[d >> 2] = c[j + 16 >> 2];
						b = 1;
					} else b = 0;
				} else b = 0; else b = 1;
			} else b = 0; else b = 1;
			i = k;
			return b | 0;
		}
		function Bg(d, e, f, g) {
			d = d | 0;
			e = e | 0;
			f = f | 0;
			g = g | 0;
			var h = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0;
			r = i;
			i = i + 64 | 0;
			q = r;
			p = c[d >> 2] | 0;
			o = d + (c[p + -8 >> 2] | 0) | 0;
			p = c[p + -4 >> 2] | 0;
			c[q >> 2] = f;
			c[q + 4 >> 2] = d;
			c[q + 8 >> 2] = e;
			c[q + 12 >> 2] = g;
			h = q + 16 | 0;
			j = q + 20 | 0;
			k = q + 24 | 0;
			l = q + 28 | 0;
			m = q + 32 | 0;
			n = q + 40 | 0;
			e = (p | 0) == (f | 0);
			d = h + 0 | 0;
			g = d + 36 | 0;
			do {
				c[d >> 2] = 0;
				d = d + 4 | 0;
			} while ((d | 0) < (g | 0));
			b[h + 36 >> 1] = 0;
			a[h + 38 >> 0] = 0;
			do if (e) {
				c[q + 48 >> 2] = 1;
				Fc[c[(c[f >> 2] | 0) + 20 >> 2] & 7](f, q, o, o, 1, 0);
				g = (c[k >> 2] | 0) == 1 ? o : 0;
			} else {
				wc[c[(c[p >> 2] | 0) + 24 >> 2] & 7](p, q, o, 1, 0);
				g = c[q + 36 >> 2] | 0;
				if (!g) {
					g = (c[n >> 2] | 0) == 1 & (c[l >> 2] | 0) == 1 & (c[m >> 2] | 0) == 1 ? c[j >> 2] | 0 : 0;
					break;
				} else if ((g | 0) != 1) {
					g = 0;
					break;
				}
				if ((c[k >> 2] | 0) != 1 ? !((c[n >> 2] | 0) == 0 & (c[l >> 2] | 0) == 1 & (c[m >> 2] | 0) == 1) : 0) {
					g = 0;
					break;
				}
				g = c[h >> 2] | 0;
			} while (0);
			i = r;
			return g | 0;
		}
		function Cg(b, d, e, f, g) {
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			g = g | 0;
			a[d + 53 >> 0] = 1;
			do if ((c[d + 4 >> 2] | 0) == (f | 0)) {
				a[d + 52 >> 0] = 1;
				f = d + 16 | 0;
				b = c[f >> 2] | 0;
				if (!b) {
					c[f >> 2] = e;
					c[d + 24 >> 2] = g;
					c[d + 36 >> 2] = 1;
					if (!((g | 0) == 1 ? (c[d + 48 >> 2] | 0) == 1 : 0)) break;
					a[d + 54 >> 0] = 1;
					break;
				}
				if ((b | 0) != (e | 0)) {
					b = d + 36 | 0;
					c[b >> 2] = (c[b >> 2] | 0) + 1;
					a[d + 54 >> 0] = 1;
					break;
				}
				f = d + 24 | 0;
				b = c[f >> 2] | 0;
				if ((b | 0) == 2) {
					c[f >> 2] = g;
					b = g;
				}
				if ((b | 0) == 1 ? (c[d + 48 >> 2] | 0) == 1 : 0) a[d + 54 >> 0] = 1;
			} while (0);
			return;
		}
		function Dg(b, d, e, f, g) {
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			g = g | 0;
			var h = 0, i = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0;
			a: do if ((b | 0) == (c[d + 8 >> 2] | 0)) {
				if ((c[d + 4 >> 2] | 0) == (e | 0) ? (i = d + 28 | 0, (c[i >> 2] | 0) != 1) : 0) c[i >> 2] = f;
			} else {
				if ((b | 0) != (c[d >> 2] | 0)) {
					p = c[b + 12 >> 2] | 0;
					k = b + (p << 3) + 16 | 0;
					Fg(b + 16 | 0, d, e, f, g);
					h = b + 24 | 0;
					if ((p | 0) <= 1) break;
					i = c[b + 8 >> 2] | 0;
					if ((i & 2 | 0) == 0 ? (l = d + 36 | 0, (c[l >> 2] | 0) != 1) : 0) {
						if (!(i & 1)) {
							i = d + 54 | 0;
							while (1) {
								if (a[i >> 0] | 0) break a;
								if ((c[l >> 2] | 0) == 1) break a;
								Fg(h, d, e, f, g);
								h = h + 8 | 0;
								if (h >>> 0 >= k >>> 0) break a;
							}
						}
						i = d + 24 | 0;
						j = d + 54 | 0;
						while (1) {
							if (a[j >> 0] | 0) break a;
							if ((c[l >> 2] | 0) == 1 ? (c[i >> 2] | 0) == 1 : 0) break a;
							Fg(h, d, e, f, g);
							h = h + 8 | 0;
							if (h >>> 0 >= k >>> 0) break a;
						}
					}
					i = d + 54 | 0;
					while (1) {
						if (a[i >> 0] | 0) break a;
						Fg(h, d, e, f, g);
						h = h + 8 | 0;
						if (h >>> 0 >= k >>> 0) break a;
					}
				}
				if ((c[d + 16 >> 2] | 0) != (e | 0) ? (q = d + 20 | 0, (c[q >> 2] | 0) != (e | 0)) : 0) {
					c[d + 32 >> 2] = f;
					n = d + 44 | 0;
					if ((c[n >> 2] | 0) == 4) break;
					k = b + (c[b + 12 >> 2] << 3) + 16 | 0;
					h = d + 52 | 0;
					m = d + 53 | 0;
					o = d + 54 | 0;
					f = b + 8 | 0;
					p = d + 24 | 0;
					j = 0;
					i = 0;
					l = b + 16 | 0;
					b: while (1) {
						if (l >>> 0 >= k >>> 0) {
							r = 20;
							break;
						}
						a[h >> 0] = 0;
						a[m >> 0] = 0;
						Eg(l, d, e, e, 1, g);
						if (a[o >> 0] | 0) {
							r = 20;
							break;
						}
						do if (a[m >> 0] | 0) {
							if (!(a[h >> 0] | 0)) if (!(c[f >> 2] & 1)) {
								i = 1;
								r = 20;
								break b;
							} else {
								i = 1;
								break;
							}
							if ((c[p >> 2] | 0) == 1) break b;
							if (!(c[f >> 2] & 2)) break b; else {
								j = 1;
								i = 1;
							}
						} while (0);
						l = l + 8 | 0;
					}
					do if ((r | 0) == 20) {
						if ((!j ? (c[q >> 2] = e, f = d + 40 | 0, c[f >> 2] = (c[f >> 2] | 0) + 1, (c[d + 36 >> 2] | 0) == 1) : 0) ? (c[p >> 2] | 0) == 2 : 0) {
							a[o >> 0] = 1;
							if (i) break;
						} else r = 24;
						if ((r | 0) == 24 ? i : 0) break;
						c[n >> 2] = 4;
						break a;
					} while (0);
					c[n >> 2] = 3;
					break;
				}
				if ((f | 0) == 1) c[d + 32 >> 2] = 1;
			} while (0);
			return;
		}
		function Eg(a, b, d, e, f, g) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			g = g | 0;
			var h = 0, i = 0;
			i = c[a + 4 >> 2] | 0;
			h = i >> 8;
			if (i & 1) h = c[(c[e >> 2] | 0) + h >> 2] | 0;
			a = c[a >> 2] | 0;
			Fc[c[(c[a >> 2] | 0) + 20 >> 2] & 7](a, b, d, e + h | 0, (i & 2 | 0) != 0 ? f : 2, g);
			return;
		}
		function Fg(a, b, d, e, f) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			var g = 0, h = 0;
			h = c[a + 4 >> 2] | 0;
			g = h >> 8;
			if (h & 1) g = c[(c[d >> 2] | 0) + g >> 2] | 0;
			a = c[a >> 2] | 0;
			wc[c[(c[a >> 2] | 0) + 24 >> 2] & 7](a, b, d + g | 0, (h & 2 | 0) != 0 ? e : 2, f);
			return;
		}
		function Gg(b, d, e, f, g) {
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			g = g | 0;
			var h = 0, i = 0, j = 0, k = 0;
			a: do if ((b | 0) == (c[d + 8 >> 2] | 0)) {
				if ((c[d + 4 >> 2] | 0) == (e | 0) ? (h = d + 28 | 0, (c[h >> 2] | 0) != 1) : 0) c[h >> 2] = f;
			} else {
				if ((b | 0) != (c[d >> 2] | 0)) {
					h = c[b + 8 >> 2] | 0;
					wc[c[(c[h >> 2] | 0) + 24 >> 2] & 7](h, d, e, f, g);
					break;
				}
				if ((c[d + 16 >> 2] | 0) != (e | 0) ? (i = d + 20 | 0, (c[i >> 2] | 0) != (e | 0)) : 0) {
					c[d + 32 >> 2] = f;
					f = d + 44 | 0;
					if ((c[f >> 2] | 0) == 4) break;
					h = d + 52 | 0;
					a[h >> 0] = 0;
					k = d + 53 | 0;
					a[k >> 0] = 0;
					b = c[b + 8 >> 2] | 0;
					Fc[c[(c[b >> 2] | 0) + 20 >> 2] & 7](b, d, e, e, 1, g);
					if (a[k >> 0] | 0) {
						if (!(a[h >> 0] | 0)) {
							h = 1;
							j = 13;
						}
					} else {
						h = 0;
						j = 13;
					}
					do if ((j | 0) == 13) {
						c[i >> 2] = e;
						b = d + 40 | 0;
						c[b >> 2] = (c[b >> 2] | 0) + 1;
						if ((c[d + 36 >> 2] | 0) == 1 ? (c[d + 24 >> 2] | 0) == 2 : 0) {
							a[d + 54 >> 0] = 1;
							if (h) break;
						} else j = 16;
						if ((j | 0) == 16 ? h : 0) break;
						c[f >> 2] = 4;
						break a;
					} while (0);
					c[f >> 2] = 3;
					break;
				}
				if ((f | 0) == 1) c[d + 32 >> 2] = 1;
			} while (0);
			return;
		}
		function Hg(b, d, e, f, g) {
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			g = g | 0;
			var h = 0, i = 0;
			do if ((b | 0) == (c[d + 8 >> 2] | 0)) {
				if ((c[d + 4 >> 2] | 0) == (e | 0) ? (i = d + 28 | 0, (c[i >> 2] | 0) != 1) : 0) c[i >> 2] = f;
			} else if ((b | 0) == (c[d >> 2] | 0)) {
				if ((c[d + 16 >> 2] | 0) != (e | 0) ? (h = d + 20 | 0, (c[h >> 2] | 0) != (e | 0)) : 0) {
					c[d + 32 >> 2] = f;
					c[h >> 2] = e;
					h = d + 40 | 0;
					c[h >> 2] = (c[h >> 2] | 0) + 1;
					if ((c[d + 36 >> 2] | 0) == 1 ? (c[d + 24 >> 2] | 0) == 2 : 0) a[d + 54 >> 0] = 1;
					c[d + 44 >> 2] = 4;
					break;
				}
				if ((f | 0) == 1) c[d + 32 >> 2] = 1;
			} while (0);
			return;
		}
		function Ig(b, d, e, f, g, h) {
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			g = g | 0;
			h = h | 0;
			var i = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0;
			if ((b | 0) == (c[d + 8 >> 2] | 0)) Cg(0, d, e, f, g); else {
				m = d + 52 | 0;
				n = a[m >> 0] | 0;
				o = d + 53 | 0;
				p = a[o >> 0] | 0;
				l = c[b + 12 >> 2] | 0;
				i = b + (l << 3) + 16 | 0;
				a[m >> 0] = 0;
				a[o >> 0] = 0;
				Eg(b + 16 | 0, d, e, f, g, h);
				a: do if ((l | 0) > 1) {
					j = d + 24 | 0;
					k = b + 8 | 0;
					l = d + 54 | 0;
					b = b + 24 | 0;
					do {
						if (a[l >> 0] | 0) break a;
						if (!(a[m >> 0] | 0)) {
							if ((a[o >> 0] | 0) != 0 ? (c[k >> 2] & 1 | 0) == 0 : 0) break a;
						} else {
							if ((c[j >> 2] | 0) == 1) break a;
							if (!(c[k >> 2] & 2)) break a;
						}
						a[m >> 0] = 0;
						a[o >> 0] = 0;
						Eg(b, d, e, f, g, h);
						b = b + 8 | 0;
					} while (b >>> 0 < i >>> 0);
				} while (0);
				a[m >> 0] = n;
				a[o >> 0] = p;
			}
			return;
		}
		function Jg(a, b, d, e, f, g) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			g = g | 0;
			if ((a | 0) == (c[b + 8 >> 2] | 0)) Cg(0, b, d, e, f); else {
				a = c[a + 8 >> 2] | 0;
				Fc[c[(c[a >> 2] | 0) + 20 >> 2] & 7](a, b, d, e, f, g);
			}
			return;
		}
		function Kg(a, b, d, e, f, g) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			g = g | 0;
			if ((a | 0) == (c[b + 8 >> 2] | 0)) Cg(0, b, d, e, f);
			return;
		}
		function Lg(a, b, d) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			var e = 0, f = 0;
			f = i;
			i = i + 16 | 0;
			e = f;
			c[e >> 2] = c[d >> 2];
			a = Bc[c[(c[a >> 2] | 0) + 16 >> 2] & 15](a, b, e) | 0;
			if (a) c[d >> 2] = c[e >> 2];
			i = f;
			return a & 1 | 0;
		}
		function Mg(a) {
			a = a | 0;
			if (!a) a = 0; else a = (Bg(a, 4880, 5048, 0) | 0) != 0;
			return a & 1 | 0;
		}
		function Ng() {
			var a = 0, b = 0, d = 0, e = 0, f = 0, g = 0, h = 0, j = 0;
			f = i;
			i = i + 48 | 0;
			h = f + 32 | 0;
			d = f + 24 | 0;
			j = f + 16 | 0;
			g = f;
			f = f + 36 | 0;
			a = ag() | 0;
			if ((a | 0) != 0 ? (e = c[a >> 2] | 0, (e | 0) != 0) : 0) {
				a = e + 48 | 0;
				b = c[a >> 2] | 0;
				a = c[a + 4 >> 2] | 0;
				if (!((b & -256 | 0) == 1126902528 & (a | 0) == 1129074247)) {
					c[d >> 2] = c[1046];
					_f(4304, d);
				}
				if ((b | 0) == 1126902529 & (a | 0) == 1129074247) a = c[e + 44 >> 2] | 0; else a = e + 80 | 0;
				c[f >> 2] = a;
				b = c[e >> 2] | 0;
				a = c[b + 4 >> 2] | 0;
				if (Bc[c[(c[4808 >> 2] | 0) + 16 >> 2] & 15](4808, b, f) | 0) {
					b = c[f >> 2] | 0;
					d = c[1046] | 0;
					b = Ac[c[(c[b >> 2] | 0) + 8 >> 2] & 31](b) | 0;
					c[g >> 2] = d;
					c[g + 4 >> 2] = a;
					c[g + 8 >> 2] = b;
					_f(4208, g);
				} else {
					c[j >> 2] = c[1046];
					c[j + 4 >> 2] = a;
					_f(4256, j);
				}
			}
			_f(4344, h);
		}
		function Og() {
			var a = 0;
			a = i;
			i = i + 16 | 0;
			if (!(Hb(4488, 19) | 0)) {
				i = a;
				return;
			} else _f(4560, a);
		}
		function Pg(a) {
			a = a | 0;
			var b = 0;
			b = i;
			i = i + 16 | 0;
			Rg(a);
			if (!(lc(c[1122] | 0, 0) | 0)) {
				i = b;
				return;
			} else _f(4616, b);
		}
		function Qg(a) {
			a = a | 0;
			var b = 0, d = 0, e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0, v = 0, w = 0, x = 0, y = 0, z = 0, A = 0, B = 0, C = 0, D = 0, E = 0, F = 0, G = 0, H = 0, I = 0, J = 0, K = 0, L = 0, M = 0, N = 0;
			do if (a >>> 0 < 245) {
				if (a >>> 0 < 11) p = 16; else p = a + 11 & -8;
				a = p >>> 3;
				l = c[1410] | 0;
				j = l >>> a;
				if (j & 3) {
					e = (j & 1 ^ 1) + a | 0;
					f = e << 1;
					b = 5680 + (f << 2) | 0;
					f = 5680 + (f + 2 << 2) | 0;
					g = c[f >> 2] | 0;
					h = g + 8 | 0;
					i = c[h >> 2] | 0;
					do if ((b | 0) != (i | 0)) {
						if (i >>> 0 < (c[1414] | 0) >>> 0) Nb();
						d = i + 12 | 0;
						if ((c[d >> 2] | 0) == (g | 0)) {
							c[d >> 2] = b;
							c[f >> 2] = i;
							break;
						} else Nb();
					} else c[1410] = l & ~(1 << e); while (0);
					w = e << 3;
					c[g + 4 >> 2] = w | 3;
					w = g + (w | 4) | 0;
					c[w >> 2] = c[w >> 2] | 1;
					w = h;
					return w | 0;
				}
				b = c[1412] | 0;
				if (p >>> 0 > b >>> 0) {
					if (j) {
						f = 2 << a;
						f = j << a & (f | 0 - f);
						f = (f & 0 - f) + -1 | 0;
						a = f >>> 12 & 16;
						f = f >>> a;
						e = f >>> 5 & 8;
						f = f >>> e;
						d = f >>> 2 & 4;
						f = f >>> d;
						g = f >>> 1 & 2;
						f = f >>> g;
						h = f >>> 1 & 1;
						h = (e | a | d | g | h) + (f >>> h) | 0;
						f = h << 1;
						g = 5680 + (f << 2) | 0;
						f = 5680 + (f + 2 << 2) | 0;
						d = c[f >> 2] | 0;
						a = d + 8 | 0;
						e = c[a >> 2] | 0;
						do if ((g | 0) != (e | 0)) {
							if (e >>> 0 < (c[1414] | 0) >>> 0) Nb();
							i = e + 12 | 0;
							if ((c[i >> 2] | 0) == (d | 0)) {
								c[i >> 2] = g;
								c[f >> 2] = e;
								k = c[1412] | 0;
								break;
							} else Nb();
						} else {
							c[1410] = l & ~(1 << h);
							k = b;
						} while (0);
						w = h << 3;
						b = w - p | 0;
						c[d + 4 >> 2] = p | 3;
						j = d + p | 0;
						c[d + (p | 4) >> 2] = b | 1;
						c[d + w >> 2] = b;
						if (k) {
							e = c[1415] | 0;
							g = k >>> 3;
							i = g << 1;
							f = 5680 + (i << 2) | 0;
							h = c[1410] | 0;
							g = 1 << g;
							if (h & g) {
								h = 5680 + (i + 2 << 2) | 0;
								i = c[h >> 2] | 0;
								if (i >>> 0 < (c[1414] | 0) >>> 0) Nb(); else {
									m = h;
									n = i;
								}
							} else {
								c[1410] = h | g;
								m = 5680 + (i + 2 << 2) | 0;
								n = f;
							}
							c[m >> 2] = e;
							c[n + 12 >> 2] = e;
							c[e + 8 >> 2] = n;
							c[e + 12 >> 2] = f;
						}
						c[1412] = b;
						c[1415] = j;
						w = a;
						return w | 0;
					}
					a = c[1411] | 0;
					if (a) {
						h = (a & 0 - a) + -1 | 0;
						v = h >>> 12 & 16;
						h = h >>> v;
						u = h >>> 5 & 8;
						h = h >>> u;
						w = h >>> 2 & 4;
						h = h >>> w;
						i = h >>> 1 & 2;
						h = h >>> i;
						g = h >>> 1 & 1;
						g = c[5944 + ((u | v | w | i | g) + (h >>> g) << 2) >> 2] | 0;
						h = (c[g + 4 >> 2] & -8) - p | 0;
						i = g;
						while (1) {
							d = c[i + 16 >> 2] | 0;
							if (!d) {
								d = c[i + 20 >> 2] | 0;
								if (!d) {
									l = h;
									k = g;
									break;
								}
							}
							i = (c[d + 4 >> 2] & -8) - p | 0;
							w = i >>> 0 < h >>> 0;
							h = w ? i : h;
							i = d;
							g = w ? d : g;
						}
						a = c[1414] | 0;
						if (k >>> 0 < a >>> 0) Nb();
						b = k + p | 0;
						if (k >>> 0 >= b >>> 0) Nb();
						j = c[k + 24 >> 2] | 0;
						g = c[k + 12 >> 2] | 0;
						do if ((g | 0) == (k | 0)) {
							h = k + 20 | 0;
							i = c[h >> 2] | 0;
							if (!i) {
								h = k + 16 | 0;
								i = c[h >> 2] | 0;
								if (!i) {
									e = 0;
									break;
								}
							}
							while (1) {
								g = i + 20 | 0;
								f = c[g >> 2] | 0;
								if (f) {
									i = f;
									h = g;
									continue;
								}
								g = i + 16 | 0;
								f = c[g >> 2] | 0;
								if (!f) break; else {
									i = f;
									h = g;
								}
							}
							if (h >>> 0 < a >>> 0) Nb(); else {
								c[h >> 2] = 0;
								e = i;
								break;
							}
						} else {
							f = c[k + 8 >> 2] | 0;
							if (f >>> 0 < a >>> 0) Nb();
							i = f + 12 | 0;
							if ((c[i >> 2] | 0) != (k | 0)) Nb();
							h = g + 8 | 0;
							if ((c[h >> 2] | 0) == (k | 0)) {
								c[i >> 2] = g;
								c[h >> 2] = f;
								e = g;
								break;
							} else Nb();
						} while (0);
						do if (j) {
							i = c[k + 28 >> 2] | 0;
							h = 5944 + (i << 2) | 0;
							if ((k | 0) == (c[h >> 2] | 0)) {
								c[h >> 2] = e;
								if (!e) {
									c[1411] = c[1411] & ~(1 << i);
									break;
								}
							} else {
								if (j >>> 0 < (c[1414] | 0) >>> 0) Nb();
								i = j + 16 | 0;
								if ((c[i >> 2] | 0) == (k | 0)) c[i >> 2] = e; else c[j + 20 >> 2] = e;
								if (!e) break;
							}
							h = c[1414] | 0;
							if (e >>> 0 < h >>> 0) Nb();
							c[e + 24 >> 2] = j;
							i = c[k + 16 >> 2] | 0;
							do if (i) if (i >>> 0 < h >>> 0) Nb(); else {
								c[e + 16 >> 2] = i;
								c[i + 24 >> 2] = e;
								break;
							} while (0);
							i = c[k + 20 >> 2] | 0;
							if (i) if (i >>> 0 < (c[1414] | 0) >>> 0) Nb(); else {
								c[e + 20 >> 2] = i;
								c[i + 24 >> 2] = e;
								break;
							}
						} while (0);
						if (l >>> 0 < 16) {
							w = l + p | 0;
							c[k + 4 >> 2] = w | 3;
							w = k + (w + 4) | 0;
							c[w >> 2] = c[w >> 2] | 1;
						} else {
							c[k + 4 >> 2] = p | 3;
							c[k + (p | 4) >> 2] = l | 1;
							c[k + (l + p) >> 2] = l;
							d = c[1412] | 0;
							if (d) {
								e = c[1415] | 0;
								g = d >>> 3;
								i = g << 1;
								f = 5680 + (i << 2) | 0;
								h = c[1410] | 0;
								g = 1 << g;
								if (h & g) {
									i = 5680 + (i + 2 << 2) | 0;
									h = c[i >> 2] | 0;
									if (h >>> 0 < (c[1414] | 0) >>> 0) Nb(); else {
										o = i;
										q = h;
									}
								} else {
									c[1410] = h | g;
									o = 5680 + (i + 2 << 2) | 0;
									q = f;
								}
								c[o >> 2] = e;
								c[q + 12 >> 2] = e;
								c[e + 8 >> 2] = q;
								c[e + 12 >> 2] = f;
							}
							c[1412] = l;
							c[1415] = b;
						}
						w = k + 8 | 0;
						return w | 0;
					} else A = p;
				} else A = p;
			} else if (a >>> 0 <= 4294967231) {
				a = a + 11 | 0;
				o = a & -8;
				k = c[1411] | 0;
				if (k) {
					h = 0 - o | 0;
					a = a >>> 8;
					if (a) if (o >>> 0 > 16777215) l = 31; else {
						q = (a + 1048320 | 0) >>> 16 & 8;
						v = a << q;
						p = (v + 520192 | 0) >>> 16 & 4;
						v = v << p;
						l = (v + 245760 | 0) >>> 16 & 2;
						l = 14 - (p | q | l) + (v << l >>> 15) | 0;
						l = o >>> (l + 7 | 0) & 1 | l << 1;
					} else l = 0;
					f = c[5944 + (l << 2) >> 2] | 0;
					a: do if (!f) {
						a = 0;
						j = 0;
						v = 90;
					} else {
						if ((l | 0) == 31) j = 0; else j = 25 - (l >>> 1) | 0;
						d = h;
						a = 0;
						b = o << j;
						j = 0;
						while (1) {
							e = c[f + 4 >> 2] & -8;
							h = e - o | 0;
							if (h >>> 0 < d >>> 0) if ((e | 0) == (o | 0)) {
								a = f;
								j = f;
								v = 94;
								break a;
							} else j = f; else h = d;
							v = c[f + 20 >> 2] | 0;
							f = c[f + (b >>> 31 << 2) + 16 >> 2] | 0;
							a = (v | 0) == 0 | (v | 0) == (f | 0) ? a : v;
							if (!f) {
								v = 90;
								break;
							} else {
								d = h;
								b = b << 1;
							}
						}
					} while (0);
					if ((v | 0) == 90) {
						if ((a | 0) == 0 & (j | 0) == 0) {
							a = 2 << l;
							a = k & (a | 0 - a);
							if (!a) {
								A = o;
								break;
							}
							q = (a & 0 - a) + -1 | 0;
							m = q >>> 12 & 16;
							q = q >>> m;
							l = q >>> 5 & 8;
							q = q >>> l;
							n = q >>> 2 & 4;
							q = q >>> n;
							p = q >>> 1 & 2;
							q = q >>> p;
							a = q >>> 1 & 1;
							a = c[5944 + ((l | m | n | p | a) + (q >>> a) << 2) >> 2] | 0;
						}
						if (!a) {
							m = h;
							p = j;
						} else v = 94;
					}
					if ((v | 0) == 94) while (1) {
						v = 0;
						q = (c[a + 4 >> 2] & -8) - o | 0;
						f = q >>> 0 < h >>> 0;
						h = f ? q : h;
						j = f ? a : j;
						f = c[a + 16 >> 2] | 0;
						if (f) {
							a = f;
							v = 94;
							continue;
						}
						a = c[a + 20 >> 2] | 0;
						if (!a) {
							m = h;
							p = j;
							break;
						} else v = 94;
					}
					if ((p | 0) != 0 ? m >>> 0 < ((c[1412] | 0) - o | 0) >>> 0 : 0) {
						a = c[1414] | 0;
						if (p >>> 0 < a >>> 0) Nb();
						n = p + o | 0;
						if (p >>> 0 >= n >>> 0) Nb();
						j = c[p + 24 >> 2] | 0;
						g = c[p + 12 >> 2] | 0;
						do if ((g | 0) == (p | 0)) {
							h = p + 20 | 0;
							i = c[h >> 2] | 0;
							if (!i) {
								h = p + 16 | 0;
								i = c[h >> 2] | 0;
								if (!i) {
									r = 0;
									break;
								}
							}
							while (1) {
								g = i + 20 | 0;
								f = c[g >> 2] | 0;
								if (f) {
									i = f;
									h = g;
									continue;
								}
								g = i + 16 | 0;
								f = c[g >> 2] | 0;
								if (!f) break; else {
									i = f;
									h = g;
								}
							}
							if (h >>> 0 < a >>> 0) Nb(); else {
								c[h >> 2] = 0;
								r = i;
								break;
							}
						} else {
							f = c[p + 8 >> 2] | 0;
							if (f >>> 0 < a >>> 0) Nb();
							i = f + 12 | 0;
							if ((c[i >> 2] | 0) != (p | 0)) Nb();
							h = g + 8 | 0;
							if ((c[h >> 2] | 0) == (p | 0)) {
								c[i >> 2] = g;
								c[h >> 2] = f;
								r = g;
								break;
							} else Nb();
						} while (0);
						do if (j) {
							i = c[p + 28 >> 2] | 0;
							h = 5944 + (i << 2) | 0;
							if ((p | 0) == (c[h >> 2] | 0)) {
								c[h >> 2] = r;
								if (!r) {
									c[1411] = c[1411] & ~(1 << i);
									break;
								}
							} else {
								if (j >>> 0 < (c[1414] | 0) >>> 0) Nb();
								i = j + 16 | 0;
								if ((c[i >> 2] | 0) == (p | 0)) c[i >> 2] = r; else c[j + 20 >> 2] = r;
								if (!r) break;
							}
							h = c[1414] | 0;
							if (r >>> 0 < h >>> 0) Nb();
							c[r + 24 >> 2] = j;
							i = c[p + 16 >> 2] | 0;
							do if (i) if (i >>> 0 < h >>> 0) Nb(); else {
								c[r + 16 >> 2] = i;
								c[i + 24 >> 2] = r;
								break;
							} while (0);
							i = c[p + 20 >> 2] | 0;
							if (i) if (i >>> 0 < (c[1414] | 0) >>> 0) Nb(); else {
								c[r + 20 >> 2] = i;
								c[i + 24 >> 2] = r;
								break;
							}
						} while (0);
						b: do if (m >>> 0 >= 16) {
							c[p + 4 >> 2] = o | 3;
							c[p + (o | 4) >> 2] = m | 1;
							c[p + (m + o) >> 2] = m;
							i = m >>> 3;
							if (m >>> 0 < 256) {
								h = i << 1;
								f = 5680 + (h << 2) | 0;
								g = c[1410] | 0;
								i = 1 << i;
								if (g & i) {
									i = 5680 + (h + 2 << 2) | 0;
									h = c[i >> 2] | 0;
									if (h >>> 0 < (c[1414] | 0) >>> 0) Nb(); else {
										s = i;
										t = h;
									}
								} else {
									c[1410] = g | i;
									s = 5680 + (h + 2 << 2) | 0;
									t = f;
								}
								c[s >> 2] = n;
								c[t + 12 >> 2] = n;
								c[p + (o + 8) >> 2] = t;
								c[p + (o + 12) >> 2] = f;
								break;
							}
							d = m >>> 8;
							if (d) if (m >>> 0 > 16777215) f = 31; else {
								v = (d + 1048320 | 0) >>> 16 & 8;
								w = d << v;
								u = (w + 520192 | 0) >>> 16 & 4;
								w = w << u;
								f = (w + 245760 | 0) >>> 16 & 2;
								f = 14 - (u | v | f) + (w << f >>> 15) | 0;
								f = m >>> (f + 7 | 0) & 1 | f << 1;
							} else f = 0;
							i = 5944 + (f << 2) | 0;
							c[p + (o + 28) >> 2] = f;
							c[p + (o + 20) >> 2] = 0;
							c[p + (o + 16) >> 2] = 0;
							h = c[1411] | 0;
							g = 1 << f;
							if (!(h & g)) {
								c[1411] = h | g;
								c[i >> 2] = n;
								c[p + (o + 24) >> 2] = i;
								c[p + (o + 12) >> 2] = n;
								c[p + (o + 8) >> 2] = n;
								break;
							}
							d = c[i >> 2] | 0;
							if ((f | 0) == 31) b = 0; else b = 25 - (f >>> 1) | 0;
							c: do if ((c[d + 4 >> 2] & -8 | 0) != (m | 0)) {
								h = m << b;
								while (1) {
									b = d + (h >>> 31 << 2) + 16 | 0;
									i = c[b >> 2] | 0;
									if (!i) break;
									if ((c[i + 4 >> 2] & -8 | 0) == (m | 0)) {
										A = i;
										break c;
									} else {
										h = h << 1;
										d = i;
									}
								}
								if (b >>> 0 < (c[1414] | 0) >>> 0) Nb(); else {
									c[b >> 2] = n;
									c[p + (o + 24) >> 2] = d;
									c[p + (o + 12) >> 2] = n;
									c[p + (o + 8) >> 2] = n;
									break b;
								}
							} else A = d; while (0);
							d = A + 8 | 0;
							b = c[d >> 2] | 0;
							w = c[1414] | 0;
							if (A >>> 0 >= w >>> 0 & b >>> 0 >= w >>> 0) {
								c[b + 12 >> 2] = n;
								c[d >> 2] = n;
								c[p + (o + 8) >> 2] = b;
								c[p + (o + 12) >> 2] = A;
								c[p + (o + 24) >> 2] = 0;
								break;
							} else Nb();
						} else {
							w = m + o | 0;
							c[p + 4 >> 2] = w | 3;
							w = p + (w + 4) | 0;
							c[w >> 2] = c[w >> 2] | 1;
						} while (0);
						w = p + 8 | 0;
						return w | 0;
					} else A = o;
				} else A = o;
			} else A = -1; while (0);
			a = c[1412] | 0;
			if (a >>> 0 >= A >>> 0) {
				b = a - A | 0;
				d = c[1415] | 0;
				if (b >>> 0 > 15) {
					c[1415] = d + A;
					c[1412] = b;
					c[d + (A + 4) >> 2] = b | 1;
					c[d + a >> 2] = b;
					c[d + 4 >> 2] = A | 3;
				} else {
					c[1412] = 0;
					c[1415] = 0;
					c[d + 4 >> 2] = a | 3;
					w = d + (a + 4) | 0;
					c[w >> 2] = c[w >> 2] | 1;
				}
				w = d + 8 | 0;
				return w | 0;
			}
			a = c[1413] | 0;
			if (a >>> 0 > A >>> 0) {
				v = a - A | 0;
				c[1413] = v;
				w = c[1416] | 0;
				c[1416] = w + A;
				c[w + (A + 4) >> 2] = v | 1;
				c[w + 4 >> 2] = A | 3;
				w = w + 8 | 0;
				return w | 0;
			}
			do if (!(c[1528] | 0)) {
				a = Ha(30) | 0;
				if (!(a + -1 & a)) {
					c[1530] = a;
					c[1529] = a;
					c[1531] = -1;
					c[1532] = -1;
					c[1533] = 0;
					c[1521] = 0;
					c[1528] = (kb(0) | 0) & -16 ^ 1431655768;
					break;
				} else Nb();
			} while (0);
			l = A + 48 | 0;
			e = c[1530] | 0;
			b = A + 47 | 0;
			f = e + b | 0;
			e = 0 - e | 0;
			d = f & e;
			if (d >>> 0 <= A >>> 0) {
				w = 0;
				return w | 0;
			}
			a = c[1520] | 0;
			if ((a | 0) != 0 ? (s = c[1518] | 0, t = s + d | 0, t >>> 0 <= s >>> 0 | t >>> 0 > a >>> 0) : 0) {
				w = 0;
				return w | 0;
			}
			d: do if (!(c[1521] & 4)) {
				a = c[1416] | 0;
				e: do if (a) {
					h = 6088 | 0;
					while (1) {
						j = c[h >> 2] | 0;
						if (j >>> 0 <= a >>> 0 ? (i = h + 4 | 0, (j + (c[i >> 2] | 0) | 0) >>> 0 > a >>> 0) : 0) break;
						h = c[h + 8 >> 2] | 0;
						if (!h) {
							v = 180;
							break e;
						}
					}
					a = f - (c[1413] | 0) & e;
					if (a >>> 0 < 2147483647) {
						j = ic(a | 0) | 0;
						if ((j | 0) == ((c[h >> 2] | 0) + (c[i >> 2] | 0) | 0)) {
							if ((j | 0) != (-1 | 0)) {
								w = j;
								v = 200;
								break d;
							}
						} else v = 190;
					} else a = 0;
				} else v = 180; while (0);
				do if ((v | 0) == 180) {
					h = ic(0) | 0;
					if ((h | 0) != (-1 | 0)) {
						a = h;
						j = c[1529] | 0;
						i = j + -1 | 0;
						if (!(i & a)) a = d; else a = d - a + (i + a & 0 - j) | 0;
						j = c[1518] | 0;
						i = j + a | 0;
						if (a >>> 0 > A >>> 0 & a >>> 0 < 2147483647) {
							t = c[1520] | 0;
							if ((t | 0) != 0 ? i >>> 0 <= j >>> 0 | i >>> 0 > t >>> 0 : 0) {
								a = 0;
								break;
							}
							j = ic(a | 0) | 0;
							if ((j | 0) == (h | 0)) {
								w = h;
								v = 200;
								break d;
							} else v = 190;
						} else a = 0;
					} else a = 0;
				} while (0);
				f: do if ((v | 0) == 190) {
					i = 0 - a | 0;
					do if (l >>> 0 > a >>> 0 & (a >>> 0 < 2147483647 & (j | 0) != (-1 | 0)) ? (u = c[1530] | 0,
						u = b - a + u & 0 - u, u >>> 0 < 2147483647) : 0) if ((ic(u | 0) | 0) == (-1 | 0)) {
							ic(i | 0) | 0;
							a = 0;
							break f;
						} else {
							a = u + a | 0;
							break;
						} while (0);
					if ((j | 0) == (-1 | 0)) a = 0; else {
						w = j;
						v = 200;
						break d;
					}
				} while (0);
				c[1521] = c[1521] | 4;
				v = 197;
			} else {
				a = 0;
				v = 197;
			} while (0);
			if ((((v | 0) == 197 ? d >>> 0 < 2147483647 : 0) ? (w = ic(d | 0) | 0, x = ic(0) | 0,
				w >>> 0 < x >>> 0 & ((w | 0) != (-1 | 0) & (x | 0) != (-1 | 0))) : 0) ? (y = x - w | 0,
					z = y >>> 0 > (A + 40 | 0) >>> 0, z) : 0) {
				a = z ? y : a;
				v = 200;
			}
			if ((v | 0) == 200) {
				j = (c[1518] | 0) + a | 0;
				c[1518] = j;
				if (j >>> 0 > (c[1519] | 0) >>> 0) c[1519] = j;
				l = c[1416] | 0;
				g: do if (l) {
					f = 6088 | 0;
					do {
						j = c[f >> 2] | 0;
						i = f + 4 | 0;
						h = c[i >> 2] | 0;
						if ((w | 0) == (j + h | 0)) {
							B = j;
							C = i;
							D = h;
							E = f;
							v = 212;
							break;
						}
						f = c[f + 8 >> 2] | 0;
					} while ((f | 0) != 0);
					if (((v | 0) == 212 ? (c[E + 12 >> 2] & 8 | 0) == 0 : 0) ? l >>> 0 < w >>> 0 & l >>> 0 >= B >>> 0 : 0) {
						c[C >> 2] = D + a;
						b = (c[1413] | 0) + a | 0;
						d = l + 8 | 0;
						if (!(d & 7)) d = 0; else d = 0 - d & 7;
						w = b - d | 0;
						c[1416] = l + d;
						c[1413] = w;
						c[l + (d + 4) >> 2] = w | 1;
						c[l + (b + 4) >> 2] = 40;
						c[1417] = c[1532];
						break;
					}
					j = c[1414] | 0;
					if (w >>> 0 < j >>> 0) {
						c[1414] = w;
						j = w;
					}
					i = w + a | 0;
					f = 6088 | 0;
					while (1) {
						if ((c[f >> 2] | 0) == (i | 0)) {
							h = f;
							i = f;
							v = 222;
							break;
						}
						f = c[f + 8 >> 2] | 0;
						if (!f) {
							h = 6088 | 0;
							break;
						}
					}
					if ((v | 0) == 222) if (!(c[i + 12 >> 2] & 8)) {
						c[h >> 2] = w;
						i = i + 4 | 0;
						c[i >> 2] = (c[i >> 2] | 0) + a;
						i = w + 8 | 0;
						if (!(i & 7)) p = 0; else p = 0 - i & 7;
						i = w + (a + 8) | 0;
						if (!(i & 7)) k = 0; else k = 0 - i & 7;
						i = w + (k + a) | 0;
						n = p + A | 0;
						o = w + n | 0;
						m = i - (w + p) - A | 0;
						c[w + (p + 4) >> 2] = A | 3;
						h: do if ((i | 0) != (l | 0)) {
							if ((i | 0) == (c[1415] | 0)) {
								v = (c[1412] | 0) + m | 0;
								c[1412] = v;
								c[1415] = o;
								c[w + (n + 4) >> 2] = v | 1;
								c[w + (v + n) >> 2] = v;
								break;
							}
							l = a + 4 | 0;
							h = c[w + (l + k) >> 2] | 0;
							if ((h & 3 | 0) == 1) {
								b = h & -8;
								e = h >>> 3;
								i: do if (h >>> 0 >= 256) {
									d = c[w + ((k | 24) + a) >> 2] | 0;
									g = c[w + (a + 12 + k) >> 2] | 0;
									do if ((g | 0) == (i | 0)) {
										f = k | 16;
										g = w + (l + f) | 0;
										h = c[g >> 2] | 0;
										if (!h) {
											g = w + (f + a) | 0;
											h = c[g >> 2] | 0;
											if (!h) {
												K = 0;
												break;
											}
										}
										while (1) {
											f = h + 20 | 0;
											e = c[f >> 2] | 0;
											if (e) {
												h = e;
												g = f;
												continue;
											}
											f = h + 16 | 0;
											e = c[f >> 2] | 0;
											if (!e) break; else {
												h = e;
												g = f;
											}
										}
										if (g >>> 0 < j >>> 0) Nb(); else {
											c[g >> 2] = 0;
											K = h;
											break;
										}
									} else {
										f = c[w + ((k | 8) + a) >> 2] | 0;
										if (f >>> 0 < j >>> 0) Nb();
										j = f + 12 | 0;
										if ((c[j >> 2] | 0) != (i | 0)) Nb();
										h = g + 8 | 0;
										if ((c[h >> 2] | 0) == (i | 0)) {
											c[j >> 2] = g;
											c[h >> 2] = f;
											K = g;
											break;
										} else Nb();
									} while (0);
									if (!d) break;
									j = c[w + (a + 28 + k) >> 2] | 0;
									h = 5944 + (j << 2) | 0;
									do if ((i | 0) != (c[h >> 2] | 0)) {
										if (d >>> 0 < (c[1414] | 0) >>> 0) Nb();
										j = d + 16 | 0;
										if ((c[j >> 2] | 0) == (i | 0)) c[j >> 2] = K; else c[d + 20 >> 2] = K;
										if (!K) break i;
									} else {
										c[h >> 2] = K;
										if (K) break;
										c[1411] = c[1411] & ~(1 << j);
										break i;
									} while (0);
									h = c[1414] | 0;
									if (K >>> 0 < h >>> 0) Nb();
									c[K + 24 >> 2] = d;
									j = k | 16;
									i = c[w + (j + a) >> 2] | 0;
									do if (i) if (i >>> 0 < h >>> 0) Nb(); else {
										c[K + 16 >> 2] = i;
										c[i + 24 >> 2] = K;
										break;
									} while (0);
									i = c[w + (l + j) >> 2] | 0;
									if (!i) break;
									if (i >>> 0 < (c[1414] | 0) >>> 0) Nb(); else {
										c[K + 20 >> 2] = i;
										c[i + 24 >> 2] = K;
										break;
									}
								} else {
									g = c[w + ((k | 8) + a) >> 2] | 0;
									f = c[w + (a + 12 + k) >> 2] | 0;
									h = 5680 + (e << 1 << 2) | 0;
									do if ((g | 0) != (h | 0)) {
										if (g >>> 0 < j >>> 0) Nb();
										if ((c[g + 12 >> 2] | 0) == (i | 0)) break;
										Nb();
									} while (0);
									if ((f | 0) == (g | 0)) {
										c[1410] = c[1410] & ~(1 << e);
										break;
									}
									do if ((f | 0) == (h | 0)) G = f + 8 | 0; else {
										if (f >>> 0 < j >>> 0) Nb();
										j = f + 8 | 0;
										if ((c[j >> 2] | 0) == (i | 0)) {
											G = j;
											break;
										}
										Nb();
									} while (0);
									c[g + 12 >> 2] = f;
									c[G >> 2] = g;
								} while (0);
								i = w + ((b | k) + a) | 0;
								j = b + m | 0;
							} else j = m;
							i = i + 4 | 0;
							c[i >> 2] = c[i >> 2] & -2;
							c[w + (n + 4) >> 2] = j | 1;
							c[w + (j + n) >> 2] = j;
							i = j >>> 3;
							if (j >>> 0 < 256) {
								h = i << 1;
								f = 5680 + (h << 2) | 0;
								g = c[1410] | 0;
								i = 1 << i;
								do if (!(g & i)) {
									c[1410] = g | i;
									L = 5680 + (h + 2 << 2) | 0;
									M = f;
								} else {
									i = 5680 + (h + 2 << 2) | 0;
									h = c[i >> 2] | 0;
									if (h >>> 0 >= (c[1414] | 0) >>> 0) {
										L = i;
										M = h;
										break;
									}
									Nb();
								} while (0);
								c[L >> 2] = o;
								c[M + 12 >> 2] = o;
								c[w + (n + 8) >> 2] = M;
								c[w + (n + 12) >> 2] = f;
								break;
							}
							d = j >>> 8;
							do if (!d) f = 0; else {
								if (j >>> 0 > 16777215) {
									f = 31;
									break;
								}
								u = (d + 1048320 | 0) >>> 16 & 8;
								v = d << u;
								t = (v + 520192 | 0) >>> 16 & 4;
								v = v << t;
								f = (v + 245760 | 0) >>> 16 & 2;
								f = 14 - (t | u | f) + (v << f >>> 15) | 0;
								f = j >>> (f + 7 | 0) & 1 | f << 1;
							} while (0);
							i = 5944 + (f << 2) | 0;
							c[w + (n + 28) >> 2] = f;
							c[w + (n + 20) >> 2] = 0;
							c[w + (n + 16) >> 2] = 0;
							h = c[1411] | 0;
							g = 1 << f;
							if (!(h & g)) {
								c[1411] = h | g;
								c[i >> 2] = o;
								c[w + (n + 24) >> 2] = i;
								c[w + (n + 12) >> 2] = o;
								c[w + (n + 8) >> 2] = o;
								break;
							}
							d = c[i >> 2] | 0;
							if ((f | 0) == 31) i = 0; else i = 25 - (f >>> 1) | 0;
							j: do if ((c[d + 4 >> 2] & -8 | 0) != (j | 0)) {
								h = j << i;
								while (1) {
									b = d + (h >>> 31 << 2) + 16 | 0;
									i = c[b >> 2] | 0;
									if (!i) break;
									if ((c[i + 4 >> 2] & -8 | 0) == (j | 0)) {
										N = i;
										break j;
									} else {
										h = h << 1;
										d = i;
									}
								}
								if (b >>> 0 < (c[1414] | 0) >>> 0) Nb(); else {
									c[b >> 2] = o;
									c[w + (n + 24) >> 2] = d;
									c[w + (n + 12) >> 2] = o;
									c[w + (n + 8) >> 2] = o;
									break h;
								}
							} else N = d; while (0);
							d = N + 8 | 0;
							b = c[d >> 2] | 0;
							v = c[1414] | 0;
							if (N >>> 0 >= v >>> 0 & b >>> 0 >= v >>> 0) {
								c[b + 12 >> 2] = o;
								c[d >> 2] = o;
								c[w + (n + 8) >> 2] = b;
								c[w + (n + 12) >> 2] = N;
								c[w + (n + 24) >> 2] = 0;
								break;
							} else Nb();
						} else {
							v = (c[1413] | 0) + m | 0;
							c[1413] = v;
							c[1416] = o;
							c[w + (n + 4) >> 2] = v | 1;
						} while (0);
						w = w + (p | 8) | 0;
						return w | 0;
					} else h = 6088 | 0;
					while (1) {
						i = c[h >> 2] | 0;
						if (i >>> 0 <= l >>> 0 ? (g = c[h + 4 >> 2] | 0, F = i + g | 0, F >>> 0 > l >>> 0) : 0) {
							f = F;
							break;
						}
						h = c[h + 8 >> 2] | 0;
					}
					h = i + (g + -39) | 0;
					if (!(h & 7)) h = 0; else h = 0 - h & 7;
					g = i + (g + -47 + h) | 0;
					e = l + 16 | 0;
					g = g >>> 0 < e >>> 0 ? l : g;
					h = g + 8 | 0;
					i = w + 8 | 0;
					if (!(i & 7)) i = 0; else i = 0 - i & 7;
					j = a + -40 - i | 0;
					c[1416] = w + i;
					c[1413] = j;
					c[w + (i + 4) >> 2] = j | 1;
					c[w + (a + -36) >> 2] = 40;
					c[1417] = c[1532];
					j = g + 4 | 0;
					c[j >> 2] = 27;
					c[h + 0 >> 2] = c[1522];
					c[h + 4 >> 2] = c[1523];
					c[h + 8 >> 2] = c[1524];
					c[h + 12 >> 2] = c[1525];
					c[1522] = w;
					c[1523] = a;
					c[1525] = 0;
					c[1524] = h;
					i = g + 28 | 0;
					c[i >> 2] = 7;
					if ((g + 32 | 0) >>> 0 < f >>> 0) do {
						w = i;
						i = i + 4 | 0;
						c[i >> 2] = 7;
					} while ((w + 8 | 0) >>> 0 < f >>> 0);
					if ((g | 0) != (l | 0)) {
						f = g - l | 0;
						c[j >> 2] = c[j >> 2] & -2;
						c[l + 4 >> 2] = f | 1;
						c[g >> 2] = f;
						i = f >>> 3;
						if (f >>> 0 < 256) {
							h = i << 1;
							f = 5680 + (h << 2) | 0;
							g = c[1410] | 0;
							i = 1 << i;
							do if (!(g & i)) {
								c[1410] = g | i;
								H = 5680 + (h + 2 << 2) | 0;
								I = f;
							} else {
								d = 5680 + (h + 2 << 2) | 0;
								b = c[d >> 2] | 0;
								if (b >>> 0 >= (c[1414] | 0) >>> 0) {
									H = d;
									I = b;
									break;
								}
								Nb();
							} while (0);
							c[H >> 2] = l;
							c[I + 12 >> 2] = l;
							c[l + 8 >> 2] = I;
							c[l + 12 >> 2] = f;
							break;
						}
						d = f >>> 8;
						if (d) if (f >>> 0 > 16777215) h = 31; else {
							v = (d + 1048320 | 0) >>> 16 & 8;
							w = d << v;
							u = (w + 520192 | 0) >>> 16 & 4;
							w = w << u;
							h = (w + 245760 | 0) >>> 16 & 2;
							h = 14 - (u | v | h) + (w << h >>> 15) | 0;
							h = f >>> (h + 7 | 0) & 1 | h << 1;
						} else h = 0;
						i = 5944 + (h << 2) | 0;
						c[l + 28 >> 2] = h;
						c[l + 20 >> 2] = 0;
						c[e >> 2] = 0;
						d = c[1411] | 0;
						b = 1 << h;
						if (!(d & b)) {
							c[1411] = d | b;
							c[i >> 2] = l;
							c[l + 24 >> 2] = i;
							c[l + 12 >> 2] = l;
							c[l + 8 >> 2] = l;
							break;
						}
						d = c[i >> 2] | 0;
						if ((h | 0) == 31) b = 0; else b = 25 - (h >>> 1) | 0;
						k: do if ((c[d + 4 >> 2] & -8 | 0) != (f | 0)) {
							i = f << b;
							while (1) {
								b = d + (i >>> 31 << 2) + 16 | 0;
								e = c[b >> 2] | 0;
								if (!e) break;
								if ((c[e + 4 >> 2] & -8 | 0) == (f | 0)) {
									J = e;
									break k;
								} else {
									i = i << 1;
									d = e;
								}
							}
							if (b >>> 0 < (c[1414] | 0) >>> 0) Nb(); else {
								c[b >> 2] = l;
								c[l + 24 >> 2] = d;
								c[l + 12 >> 2] = l;
								c[l + 8 >> 2] = l;
								break g;
							}
						} else J = d; while (0);
						d = J + 8 | 0;
						b = c[d >> 2] | 0;
						w = c[1414] | 0;
						if (J >>> 0 >= w >>> 0 & b >>> 0 >= w >>> 0) {
							c[b + 12 >> 2] = l;
							c[d >> 2] = l;
							c[l + 8 >> 2] = b;
							c[l + 12 >> 2] = J;
							c[l + 24 >> 2] = 0;
							break;
						} else Nb();
					}
				} else {
					v = c[1414] | 0;
					if ((v | 0) == 0 | w >>> 0 < v >>> 0) c[1414] = w;
					c[1522] = w;
					c[1523] = a;
					c[1525] = 0;
					c[1419] = c[1528];
					c[1418] = -1;
					d = 0;
					do {
						v = d << 1;
						u = 5680 + (v << 2) | 0;
						c[5680 + (v + 3 << 2) >> 2] = u;
						c[5680 + (v + 2 << 2) >> 2] = u;
						d = d + 1 | 0;
					} while ((d | 0) != 32);
					d = w + 8 | 0;
					if (!(d & 7)) d = 0; else d = 0 - d & 7;
					v = a + -40 - d | 0;
					c[1416] = w + d;
					c[1413] = v;
					c[w + (d + 4) >> 2] = v | 1;
					c[w + (a + -36) >> 2] = 40;
					c[1417] = c[1532];
				} while (0);
				b = c[1413] | 0;
				if (b >>> 0 > A >>> 0) {
					v = b - A | 0;
					c[1413] = v;
					w = c[1416] | 0;
					c[1416] = w + A;
					c[w + (A + 4) >> 2] = v | 1;
					c[w + 4 >> 2] = A | 3;
					w = w + 8 | 0;
					return w | 0;
				}
			}
			c[(kc() | 0) >> 2] = 12;
			w = 0;
			return w | 0;
		}
		function Rg(a) {
			a = a | 0;
			var b = 0, d = 0, e = 0, f = 0, g = 0, h = 0, i = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0, q = 0, r = 0, s = 0, t = 0, u = 0;
			if (!a) return;
			g = a + -8 | 0;
			h = c[1414] | 0;
			if (g >>> 0 < h >>> 0) Nb();
			f = c[a + -4 >> 2] | 0;
			e = f & 3;
			if ((e | 0) == 1) Nb();
			o = f & -8;
			q = a + (o + -8) | 0;
			do if (!(f & 1)) {
				g = c[g >> 2] | 0;
				if (!e) return;
				i = -8 - g | 0;
				l = a + i | 0;
				m = g + o | 0;
				if (l >>> 0 < h >>> 0) Nb();
				if ((l | 0) == (c[1415] | 0)) {
					g = a + (o + -4) | 0;
					f = c[g >> 2] | 0;
					if ((f & 3 | 0) != 3) {
						u = l;
						k = m;
						break;
					}
					c[1412] = m;
					c[g >> 2] = f & -2;
					c[a + (i + 4) >> 2] = m | 1;
					c[q >> 2] = m;
					return;
				}
				d = g >>> 3;
				if (g >>> 0 < 256) {
					e = c[a + (i + 8) >> 2] | 0;
					f = c[a + (i + 12) >> 2] | 0;
					g = 5680 + (d << 1 << 2) | 0;
					if ((e | 0) != (g | 0)) {
						if (e >>> 0 < h >>> 0) Nb();
						if ((c[e + 12 >> 2] | 0) != (l | 0)) Nb();
					}
					if ((f | 0) == (e | 0)) {
						c[1410] = c[1410] & ~(1 << d);
						u = l;
						k = m;
						break;
					}
					if ((f | 0) != (g | 0)) {
						if (f >>> 0 < h >>> 0) Nb();
						g = f + 8 | 0;
						if ((c[g >> 2] | 0) == (l | 0)) b = g; else Nb();
					} else b = f + 8 | 0;
					c[e + 12 >> 2] = f;
					c[b >> 2] = e;
					u = l;
					k = m;
					break;
				}
				b = c[a + (i + 24) >> 2] | 0;
				e = c[a + (i + 12) >> 2] | 0;
				do if ((e | 0) == (l | 0)) {
					f = a + (i + 20) | 0;
					g = c[f >> 2] | 0;
					if (!g) {
						f = a + (i + 16) | 0;
						g = c[f >> 2] | 0;
						if (!g) {
							j = 0;
							break;
						}
					}
					while (1) {
						e = g + 20 | 0;
						d = c[e >> 2] | 0;
						if (d) {
							g = d;
							f = e;
							continue;
						}
						e = g + 16 | 0;
						d = c[e >> 2] | 0;
						if (!d) break; else {
							g = d;
							f = e;
						}
					}
					if (f >>> 0 < h >>> 0) Nb(); else {
						c[f >> 2] = 0;
						j = g;
						break;
					}
				} else {
					d = c[a + (i + 8) >> 2] | 0;
					if (d >>> 0 < h >>> 0) Nb();
					g = d + 12 | 0;
					if ((c[g >> 2] | 0) != (l | 0)) Nb();
					f = e + 8 | 0;
					if ((c[f >> 2] | 0) == (l | 0)) {
						c[g >> 2] = e;
						c[f >> 2] = d;
						j = e;
						break;
					} else Nb();
				} while (0);
				if (b) {
					g = c[a + (i + 28) >> 2] | 0;
					f = 5944 + (g << 2) | 0;
					if ((l | 0) == (c[f >> 2] | 0)) {
						c[f >> 2] = j;
						if (!j) {
							c[1411] = c[1411] & ~(1 << g);
							u = l;
							k = m;
							break;
						}
					} else {
						if (b >>> 0 < (c[1414] | 0) >>> 0) Nb();
						g = b + 16 | 0;
						if ((c[g >> 2] | 0) == (l | 0)) c[g >> 2] = j; else c[b + 20 >> 2] = j;
						if (!j) {
							u = l;
							k = m;
							break;
						}
					}
					f = c[1414] | 0;
					if (j >>> 0 < f >>> 0) Nb();
					c[j + 24 >> 2] = b;
					g = c[a + (i + 16) >> 2] | 0;
					do if (g) if (g >>> 0 < f >>> 0) Nb(); else {
						c[j + 16 >> 2] = g;
						c[g + 24 >> 2] = j;
						break;
					} while (0);
					g = c[a + (i + 20) >> 2] | 0;
					if (g) if (g >>> 0 < (c[1414] | 0) >>> 0) Nb(); else {
						c[j + 20 >> 2] = g;
						c[g + 24 >> 2] = j;
						u = l;
						k = m;
						break;
					} else {
						u = l;
						k = m;
					}
				} else {
					u = l;
					k = m;
				}
			} else {
				u = g;
				k = o;
			} while (0);
			if (u >>> 0 >= q >>> 0) Nb();
			g = a + (o + -4) | 0;
			f = c[g >> 2] | 0;
			if (!(f & 1)) Nb();
			if (!(f & 2)) {
				if ((q | 0) == (c[1416] | 0)) {
					l = (c[1413] | 0) + k | 0;
					c[1413] = l;
					c[1416] = u;
					c[u + 4 >> 2] = l | 1;
					if ((u | 0) != (c[1415] | 0)) return;
					c[1415] = 0;
					c[1412] = 0;
					return;
				}
				if ((q | 0) == (c[1415] | 0)) {
					l = (c[1412] | 0) + k | 0;
					c[1412] = l;
					c[1415] = u;
					c[u + 4 >> 2] = l | 1;
					c[u + l >> 2] = l;
					return;
				}
				h = (f & -8) + k | 0;
				b = f >>> 3;
				do if (f >>> 0 >= 256) {
					b = c[a + (o + 16) >> 2] | 0;
					g = c[a + (o | 4) >> 2] | 0;
					do if ((g | 0) == (q | 0)) {
						f = a + (o + 12) | 0;
						g = c[f >> 2] | 0;
						if (!g) {
							f = a + (o + 8) | 0;
							g = c[f >> 2] | 0;
							if (!g) {
								p = 0;
								break;
							}
						}
						while (1) {
							e = g + 20 | 0;
							d = c[e >> 2] | 0;
							if (d) {
								g = d;
								f = e;
								continue;
							}
							e = g + 16 | 0;
							d = c[e >> 2] | 0;
							if (!d) break; else {
								g = d;
								f = e;
							}
						}
						if (f >>> 0 < (c[1414] | 0) >>> 0) Nb(); else {
							c[f >> 2] = 0;
							p = g;
							break;
						}
					} else {
						f = c[a + o >> 2] | 0;
						if (f >>> 0 < (c[1414] | 0) >>> 0) Nb();
						e = f + 12 | 0;
						if ((c[e >> 2] | 0) != (q | 0)) Nb();
						d = g + 8 | 0;
						if ((c[d >> 2] | 0) == (q | 0)) {
							c[e >> 2] = g;
							c[d >> 2] = f;
							p = g;
							break;
						} else Nb();
					} while (0);
					if (b) {
						g = c[a + (o + 20) >> 2] | 0;
						f = 5944 + (g << 2) | 0;
						if ((q | 0) == (c[f >> 2] | 0)) {
							c[f >> 2] = p;
							if (!p) {
								c[1411] = c[1411] & ~(1 << g);
								break;
							}
						} else {
							if (b >>> 0 < (c[1414] | 0) >>> 0) Nb();
							g = b + 16 | 0;
							if ((c[g >> 2] | 0) == (q | 0)) c[g >> 2] = p; else c[b + 20 >> 2] = p;
							if (!p) break;
						}
						g = c[1414] | 0;
						if (p >>> 0 < g >>> 0) Nb();
						c[p + 24 >> 2] = b;
						f = c[a + (o + 8) >> 2] | 0;
						do if (f) if (f >>> 0 < g >>> 0) Nb(); else {
							c[p + 16 >> 2] = f;
							c[f + 24 >> 2] = p;
							break;
						} while (0);
						d = c[a + (o + 12) >> 2] | 0;
						if (d) if (d >>> 0 < (c[1414] | 0) >>> 0) Nb(); else {
							c[p + 20 >> 2] = d;
							c[d + 24 >> 2] = p;
							break;
						}
					}
				} else {
					d = c[a + o >> 2] | 0;
					e = c[a + (o | 4) >> 2] | 0;
					g = 5680 + (b << 1 << 2) | 0;
					if ((d | 0) != (g | 0)) {
						if (d >>> 0 < (c[1414] | 0) >>> 0) Nb();
						if ((c[d + 12 >> 2] | 0) != (q | 0)) Nb();
					}
					if ((e | 0) == (d | 0)) {
						c[1410] = c[1410] & ~(1 << b);
						break;
					}
					if ((e | 0) != (g | 0)) {
						if (e >>> 0 < (c[1414] | 0) >>> 0) Nb();
						f = e + 8 | 0;
						if ((c[f >> 2] | 0) == (q | 0)) n = f; else Nb();
					} else n = e + 8 | 0;
					c[d + 12 >> 2] = e;
					c[n >> 2] = d;
				} while (0);
				c[u + 4 >> 2] = h | 1;
				c[u + h >> 2] = h;
				if ((u | 0) == (c[1415] | 0)) {
					c[1412] = h;
					return;
				} else g = h;
			} else {
				c[g >> 2] = f & -2;
				c[u + 4 >> 2] = k | 1;
				c[u + k >> 2] = k;
				g = k;
			}
			f = g >>> 3;
			if (g >>> 0 < 256) {
				e = f << 1;
				g = 5680 + (e << 2) | 0;
				b = c[1410] | 0;
				d = 1 << f;
				if (b & d) {
					d = 5680 + (e + 2 << 2) | 0;
					b = c[d >> 2] | 0;
					if (b >>> 0 < (c[1414] | 0) >>> 0) Nb(); else {
						r = d;
						s = b;
					}
				} else {
					c[1410] = b | d;
					r = 5680 + (e + 2 << 2) | 0;
					s = g;
				}
				c[r >> 2] = u;
				c[s + 12 >> 2] = u;
				c[u + 8 >> 2] = s;
				c[u + 12 >> 2] = g;
				return;
			}
			b = g >>> 8;
			if (b) if (g >>> 0 > 16777215) f = 31; else {
				k = (b + 1048320 | 0) >>> 16 & 8;
				l = b << k;
				j = (l + 520192 | 0) >>> 16 & 4;
				l = l << j;
				f = (l + 245760 | 0) >>> 16 & 2;
				f = 14 - (j | k | f) + (l << f >>> 15) | 0;
				f = g >>> (f + 7 | 0) & 1 | f << 1;
			} else f = 0;
			d = 5944 + (f << 2) | 0;
			c[u + 28 >> 2] = f;
			c[u + 20 >> 2] = 0;
			c[u + 16 >> 2] = 0;
			b = c[1411] | 0;
			e = 1 << f;
			a: do if (b & e) {
				d = c[d >> 2] | 0;
				if ((f | 0) == 31) b = 0; else b = 25 - (f >>> 1) | 0;
				b: do if ((c[d + 4 >> 2] & -8 | 0) != (g | 0)) {
					f = g << b;
					while (1) {
						b = d + (f >>> 31 << 2) + 16 | 0;
						e = c[b >> 2] | 0;
						if (!e) break;
						if ((c[e + 4 >> 2] & -8 | 0) == (g | 0)) {
							t = e;
							break b;
						} else {
							f = f << 1;
							d = e;
						}
					}
					if (b >>> 0 < (c[1414] | 0) >>> 0) Nb(); else {
						c[b >> 2] = u;
						c[u + 24 >> 2] = d;
						c[u + 12 >> 2] = u;
						c[u + 8 >> 2] = u;
						break a;
					}
				} else t = d; while (0);
				b = t + 8 | 0;
				d = c[b >> 2] | 0;
				l = c[1414] | 0;
				if (t >>> 0 >= l >>> 0 & d >>> 0 >= l >>> 0) {
					c[d + 12 >> 2] = u;
					c[b >> 2] = u;
					c[u + 8 >> 2] = d;
					c[u + 12 >> 2] = t;
					c[u + 24 >> 2] = 0;
					break;
				} else Nb();
			} else {
				c[1411] = b | e;
				c[d >> 2] = u;
				c[u + 24 >> 2] = d;
				c[u + 12 >> 2] = u;
				c[u + 8 >> 2] = u;
			} while (0);
			l = (c[1418] | 0) + -1 | 0;
			c[1418] = l;
			if (!l) b = 6096 | 0; else return;
			while (1) {
				b = c[b >> 2] | 0;
				if (!b) break; else b = b + 8 | 0;
			}
			c[1418] = -1;
			return;
		}
		function Sg(a, b) {
			a = +a;
			b = b | 0;
			var d = 0, e = 0, f = 0;
			h[k >> 3] = a;
			d = c[k >> 2] | 0;
			e = c[k + 4 >> 2] | 0;
			f = ah(d | 0, e | 0, 52) | 0;
			f = f & 2047;
			if (!f) {
				if (a != 0) {
					a = +Sg(a * 0x10000000000000000, b);
					d = (c[b >> 2] | 0) + -64 | 0;
				} else d = 0;
				c[b >> 2] = d;
				return +a;
			} else if ((f | 0) == 2047) return +a; else {
				c[b >> 2] = f + -1022;
				c[k >> 2] = d;
				c[k + 4 >> 2] = e & -2146435073 | 1071644672;
				a = +h[k >> 3];
				return +a;
			}
		}
		function Tg(a, b) {
			a = +a;
			b = b | 0;
			var d = 0;
			if ((b | 0) > 1023) {
				a = a * 8.98846567431158e307;
				d = b + -1023 | 0;
				if ((d | 0) > 1023) {
					d = b + -2046 | 0;
					d = (d | 0) > 1023 ? 1023 : d;
					a = a * 8.98846567431158e307;
				}
			} else if ((b | 0) < -1022) {
				a = a * 2.2250738585072014e-308;
				d = b + 1022 | 0;
				if ((d | 0) < -1022) {
					d = b + 2044 | 0;
					d = (d | 0) < -1022 ? -1022 : d;
					a = a * 2.2250738585072014e-308;
				}
			} else d = b;
			b = Zg(d + 1023 | 0, 0, 52) | 0;
			d = D;
			c[k >> 2] = b;
			c[k + 4 >> 2] = d;
			return +(a * +h[k >> 3]);
		}
		function Ug(a) {
			a = a | 0;
			var b = 0, d = 0, e = 0, f = 0, g = 0, h = 0, j = 0, k = 0;
			k = i;
			i = i + 16 | 0;
			b = k + 8 | 0;
			h = k + 4 | 0;
			d = k;
			c[h >> 2] = a;
			do if (a >>> 0 >= 212) {
				g = (a >>> 0) / 210 | 0;
				e = g * 210 | 0;
				c[d >> 2] = a - e;
				b = (Vg(6328, 6520 | 0, d, b) | 0) - 6328 >> 2;
				f = b;
				b = (c[6328 + (b << 2) >> 2] | 0) + e | 0;
				a: while (1) {
					e = 5;
					while (1) {
						if (e >>> 0 >= 47) {
							e = 211;
							j = 8;
							break;
						}
						a = c[6136 + (e << 2) >> 2] | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 106;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break; else e = e + 1 | 0;
					}
					b: do if ((j | 0) == 8) while (1) {
						j = 0;
						a = (b >>> 0) / (e >>> 0) | 0;
						if (a >>> 0 < e >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(a, e) | 0)) break b;
						a = e + 10 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 12 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 16 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 18 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 22 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 28 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 30 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 36 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 40 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 42 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 46 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 52 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 58 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 60 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 66 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 70 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 72 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 78 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 82 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 88 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 96 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 100 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 102 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 106 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 108 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 112 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 120 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 126 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 130 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 136 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 138 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 142 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 148 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 150 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 156 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 162 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 166 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 168 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 172 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 178 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 180 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 186 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 190 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 192 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 196 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 198 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break b;
						a = e + 208 | 0;
						d = (b >>> 0) / (a >>> 0) | 0;
						if (d >>> 0 < a >>> 0) {
							j = 105;
							break a;
						}
						if ((b | 0) == ($(d, a) | 0)) break; else {
							e = e + 210 | 0;
							j = 8;
						}
					} while (0);
					d = f + 1 | 0;
					b = (d | 0) == 48;
					d = b ? 0 : d;
					b = (b & 1) + g | 0;
					f = d;
					g = b;
					b = (c[6328 + (d << 2) >> 2] | 0) + (b * 210 | 0) | 0;
				}
				if ((j | 0) == 105) {
					c[h >> 2] = b;
					break;
				} else if ((j | 0) == 106) {
					c[h >> 2] = b;
					break;
				}
			} else b = c[(Vg(6136, 6328 | 0, h, b) | 0) >> 2] | 0; while (0);
			i = k;
			return b | 0;
		}
		function Vg(a, b, d, e) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			var f = 0, g = 0;
			g = c[d >> 2] | 0;
			f = a;
			d = b - a >> 2;
			a: while (1) {
				while (1) {
					if (!d) break a;
					e = (d | 0) / 2 | 0;
					if ((c[f + (e << 2) >> 2] | 0) >>> 0 < g >>> 0) break; else d = e;
				}
				f = f + (e + 1 << 2) | 0;
				d = d + -1 - e | 0;
			}
			return f | 0;
		}
		function Wg() { }
		function Xg(a, b, c, d) {
			a = a | 0;
			b = b | 0;
			c = c | 0;
			d = d | 0;
			b = b - d - (c >>> 0 > a >>> 0 | 0) >>> 0;
			return (D = b, a - c >>> 0 | 0) | 0;
		}
		function Yg(b, d, e) {
			b = b | 0;
			d = d | 0;
			e = e | 0;
			var f = 0, g = 0, h = 0, i = 0;
			f = b + e | 0;
			if ((e | 0) >= 20) {
				d = d & 255;
				h = b & 3;
				i = d | d << 8 | d << 16 | d << 24;
				g = f & ~3;
				if (h) {
					h = b + 4 - h | 0;
					while ((b | 0) < (h | 0)) {
						a[b >> 0] = d;
						b = b + 1 | 0;
					}
				}
				while ((b | 0) < (g | 0)) {
					c[b >> 2] = i;
					b = b + 4 | 0;
				}
			}
			while ((b | 0) < (f | 0)) {
				a[b >> 0] = d;
				b = b + 1 | 0;
			}
			return b - e | 0;
		}
		function Zg(a, b, c) {
			a = a | 0;
			b = b | 0;
			c = c | 0;
			if ((c | 0) < 32) {
				D = b << c | (a & (1 << c) - 1 << 32 - c) >>> 32 - c;
				return a << c;
			}
			D = a << c - 32;
			return 0;
		}
		function _g(b) {
			b = b | 0;
			var c = 0;
			c = b;
			while (a[c >> 0] | 0) c = c + 1 | 0;
			return c - b | 0;
		}
		function $g(a, b, c, d) {
			a = a | 0;
			b = b | 0;
			c = c | 0;
			d = d | 0;
			c = a + c >>> 0;
			return (D = b + d + (c >>> 0 < a >>> 0 | 0) >>> 0, c | 0) | 0;
		}
		function ah(a, b, c) {
			a = a | 0;
			b = b | 0;
			c = c | 0;
			if ((c | 0) < 32) {
				D = b >>> c;
				return a >>> c | (b & (1 << c) - 1) << 32 - c;
			}
			D = 0;
			return b >>> c - 32 | 0;
		}
		function bh(b, d, e) {
			b = b | 0;
			d = d | 0;
			e = e | 0;
			var f = 0;
			if ((e | 0) >= 4096) return Fa(b | 0, d | 0, e | 0) | 0;
			f = b | 0;
			if ((b & 3) == (d & 3)) {
				while (b & 3) {
					if (!e) return f | 0;
					a[b >> 0] = a[d >> 0] | 0;
					b = b + 1 | 0;
					d = d + 1 | 0;
					e = e - 1 | 0;
				}
				while ((e | 0) >= 4) {
					c[b >> 2] = c[d >> 2];
					b = b + 4 | 0;
					d = d + 4 | 0;
					e = e - 4 | 0;
				}
			}
			while ((e | 0) > 0) {
				a[b >> 0] = a[d >> 0] | 0;
				b = b + 1 | 0;
				d = d + 1 | 0;
				e = e - 1 | 0;
			}
			return f | 0;
		}
		function ch(b, c, d) {
			b = b | 0;
			c = c | 0;
			d = d | 0;
			var e = 0;
			if ((c | 0) < (b | 0) & (b | 0) < (c + d | 0)) {
				e = b;
				c = c + d | 0;
				b = b + d | 0;
				while ((d | 0) > 0) {
					b = b - 1 | 0;
					c = c - 1 | 0;
					d = d - 1 | 0;
					a[b >> 0] = a[c >> 0] | 0;
				}
				b = e;
			} else bh(b, c, d) | 0;
			return b | 0;
		}
		function dh(a, b, c) {
			a = a | 0;
			b = b | 0;
			c = c | 0;
			if ((c | 0) < 32) {
				D = b >> c;
				return a >>> c | (b & (1 << c) - 1) << 32 - c;
			}
			D = (b | 0) < 0 ? -1 : 0;
			return b >> c - 32 | 0;
		}
		function eh(b) {
			b = b | 0;
			var c = 0;
			c = a[m + (b & 255) >> 0] | 0;
			if ((c | 0) < 8) return c | 0;
			c = a[m + (b >> 8 & 255) >> 0] | 0;
			if ((c | 0) < 8) return c + 8 | 0;
			c = a[m + (b >> 16 & 255) >> 0] | 0;
			if ((c | 0) < 8) return c + 16 | 0;
			return (a[m + (b >>> 24) >> 0] | 0) + 24 | 0;
		}
		function fh(a, b) {
			a = a | 0;
			b = b | 0;
			var c = 0, d = 0, e = 0, f = 0;
			f = a & 65535;
			d = b & 65535;
			c = $(d, f) | 0;
			e = a >>> 16;
			d = (c >>> 16) + ($(d, e) | 0) | 0;
			b = b >>> 16;
			a = $(b, f) | 0;
			return (D = (d >>> 16) + ($(b, e) | 0) + (((d & 65535) + a | 0) >>> 16) | 0, d + a << 16 | c & 65535 | 0) | 0;
		}
		function gh(a, b, c, d) {
			a = a | 0;
			b = b | 0;
			c = c | 0;
			d = d | 0;
			var e = 0, f = 0, g = 0, h = 0, i = 0, j = 0;
			j = b >> 31 | ((b | 0) < 0 ? -1 : 0) << 1;
			i = ((b | 0) < 0 ? -1 : 0) >> 31 | ((b | 0) < 0 ? -1 : 0) << 1;
			f = d >> 31 | ((d | 0) < 0 ? -1 : 0) << 1;
			e = ((d | 0) < 0 ? -1 : 0) >> 31 | ((d | 0) < 0 ? -1 : 0) << 1;
			h = Xg(j ^ a, i ^ b, j, i) | 0;
			g = D;
			b = f ^ j;
			a = e ^ i;
			a = Xg((lh(h, g, Xg(f ^ c, e ^ d, f, e) | 0, D, 0) | 0) ^ b, D ^ a, b, a) | 0;
			return a | 0;
		}
		function hh(a, b, d, e) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			var f = 0, g = 0, h = 0, j = 0, k = 0, l = 0;
			f = i;
			i = i + 8 | 0;
			j = f | 0;
			h = b >> 31 | ((b | 0) < 0 ? -1 : 0) << 1;
			g = ((b | 0) < 0 ? -1 : 0) >> 31 | ((b | 0) < 0 ? -1 : 0) << 1;
			l = e >> 31 | ((e | 0) < 0 ? -1 : 0) << 1;
			k = ((e | 0) < 0 ? -1 : 0) >> 31 | ((e | 0) < 0 ? -1 : 0) << 1;
			b = Xg(h ^ a, g ^ b, h, g) | 0;
			a = D;
			lh(b, a, Xg(l ^ d, k ^ e, l, k) | 0, D, j) | 0;
			a = Xg(c[j >> 2] ^ h, c[j + 4 >> 2] ^ g, h, g) | 0;
			b = D;
			i = f;
			return (D = b, a) | 0;
		}
		function ih(a, b, c, d) {
			a = a | 0;
			b = b | 0;
			c = c | 0;
			d = d | 0;
			var e = 0, f = 0;
			e = a;
			f = c;
			a = fh(e, f) | 0;
			c = D;
			return (D = ($(b, f) | 0) + ($(d, e) | 0) + c | c & 0, a | 0 | 0) | 0;
		}
		function jh(a, b, c, d) {
			a = a | 0;
			b = b | 0;
			c = c | 0;
			d = d | 0;
			a = lh(a, b, c, d, 0) | 0;
			return a | 0;
		}
		function kh(a, b, d, e) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			var f = 0, g = 0;
			g = i;
			i = i + 8 | 0;
			f = g | 0;
			lh(a, b, d, e, f) | 0;
			i = g;
			return (D = c[f + 4 >> 2] | 0, c[f >> 2] | 0) | 0;
		}
		function lh(a, b, d, e, f) {
			a = a | 0;
			b = b | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			var g = 0, h = 0, i = 0, j = 0, k = 0, l = 0, m = 0, n = 0, o = 0, p = 0;
			n = a;
			l = b;
			m = l;
			k = d;
			o = e;
			i = o;
			if (!m) {
				g = (f | 0) != 0;
				if (!i) {
					if (g) {
						c[f >> 2] = (n >>> 0) % (k >>> 0);
						c[f + 4 >> 2] = 0;
					}
					l = 0;
					m = (n >>> 0) / (k >>> 0) >>> 0;
					return (D = l, m) | 0;
				} else {
					if (!g) {
						l = 0;
						m = 0;
						return (D = l, m) | 0;
					}
					c[f >> 2] = a | 0;
					c[f + 4 >> 2] = b & 0;
					l = 0;
					m = 0;
					return (D = l, m) | 0;
				}
			}
			j = (i | 0) == 0;
			do if (k) {
				if (!j) {
					h = (ba(i | 0) | 0) - (ba(m | 0) | 0) | 0;
					if (h >>> 0 <= 31) {
						g = h + 1 | 0;
						l = 31 - h | 0;
						k = h - 31 >> 31;
						i = g;
						j = n >>> (g >>> 0) & k | m << l;
						k = m >>> (g >>> 0) & k;
						g = 0;
						h = n << l;
						break;
					}
					if (!f) {
						l = 0;
						m = 0;
						return (D = l, m) | 0;
					}
					c[f >> 2] = a | 0;
					c[f + 4 >> 2] = l | b & 0;
					l = 0;
					m = 0;
					return (D = l, m) | 0;
				}
				j = k - 1 | 0;
				if (j & k) {
					h = (ba(k | 0) | 0) + 33 - (ba(m | 0) | 0) | 0;
					p = 64 - h | 0;
					l = 32 - h | 0;
					a = l >> 31;
					b = h - 32 | 0;
					k = b >> 31;
					i = h;
					j = l - 1 >> 31 & m >>> (b >>> 0) | (m << l | n >>> (h >>> 0)) & k;
					k = k & m >>> (h >>> 0);
					g = n << p & a;
					h = (m << p | n >>> (b >>> 0)) & a | n << l & h - 33 >> 31;
					break;
				}
				if (f) {
					c[f >> 2] = j & n;
					c[f + 4 >> 2] = 0;
				}
				if ((k | 0) == 1) {
					l = l | b & 0;
					m = a | 0 | 0;
					return (D = l, m) | 0;
				} else {
					a = eh(k | 0) | 0;
					l = m >>> (a >>> 0) | 0;
					m = m << 32 - a | n >>> (a >>> 0) | 0;
					return (D = l, m) | 0;
				}
			} else {
				if (j) {
					if (f) {
						c[f >> 2] = (m >>> 0) % (k >>> 0);
						c[f + 4 >> 2] = 0;
					}
					l = 0;
					m = (m >>> 0) / (k >>> 0) >>> 0;
					return (D = l, m) | 0;
				}
				if (!n) {
					if (f) {
						c[f >> 2] = 0;
						c[f + 4 >> 2] = (m >>> 0) % (i >>> 0);
					}
					l = 0;
					m = (m >>> 0) / (i >>> 0) >>> 0;
					return (D = l, m) | 0;
				}
				j = i - 1 | 0;
				if (!(j & i)) {
					if (f) {
						c[f >> 2] = a | 0;
						c[f + 4 >> 2] = j & m | b & 0;
					}
					l = 0;
					m = m >>> ((eh(i | 0) | 0) >>> 0);
					return (D = l, m) | 0;
				}
				h = (ba(i | 0) | 0) - (ba(m | 0) | 0) | 0;
				if (h >>> 0 <= 30) {
					k = h + 1 | 0;
					h = 31 - h | 0;
					i = k;
					j = m << h | n >>> (k >>> 0);
					k = m >>> (k >>> 0);
					g = 0;
					h = n << h;
					break;
				}
				if (!f) {
					l = 0;
					m = 0;
					return (D = l, m) | 0;
				}
				c[f >> 2] = a | 0;
				c[f + 4 >> 2] = l | b & 0;
				l = 0;
				m = 0;
				return (D = l, m) | 0;
			} while (0);
			if (!i) {
				l = h;
				i = 0;
				h = 0;
			} else {
				m = d | 0 | 0;
				l = o | e & 0;
				b = $g(m, l, -1, -1) | 0;
				a = D;
				d = h;
				h = 0;
				do {
					p = d;
					d = g >>> 31 | d << 1;
					g = h | g << 1;
					p = j << 1 | p >>> 31 | 0;
					o = j >>> 31 | k << 1 | 0;
					Xg(b, a, p, o) | 0;
					n = D;
					e = n >> 31 | ((n | 0) < 0 ? -1 : 0) << 1;
					h = e & 1;
					j = Xg(p, o, e & m, (((n | 0) < 0 ? -1 : 0) >> 31 | ((n | 0) < 0 ? -1 : 0) << 1) & l) | 0;
					k = D;
					i = i - 1 | 0;
				} while ((i | 0) != 0);
				l = d;
				i = 0;
			}
			d = 0;
			if (f) {
				c[f >> 2] = j;
				c[f + 4 >> 2] = k;
			}
			l = (g | 0) >>> 31 | (l | d) << 1 | (d << 1 | g >>> 31) & 0 | i;
			m = (g << 1 | 0 >>> 31) & -2 | h;
			return (D = l, m) | 0;
		}
		function mh(a, b, c, d, e) {
			a = a | 0;
			b = b | 0;
			c = c | 0;
			d = d | 0;
			e = e | 0;
			return uc[a & 3](b | 0, c | 0, d | 0, e | 0) | 0;
		}
		function nh(a, b, c) {
			a = a | 0;
			b = b | 0;
			c = c | 0;
			return +vc[a & 1](b | 0, c | 0);
		}
		function oh(a, b, c, d, e, f) {
			a = a | 0;
			b = b | 0;
			c = c | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			wc[a & 7](b | 0, c | 0, d | 0, e | 0, f | 0);
		}
		function ph(a) {
			a = a | 0;
			return xc[a & 7]() | 0;
		}
		function qh(a, b) {
			a = a | 0;
			b = b | 0;
			yc[a & 31](b | 0);
		}
		function rh(a, b, c) {
			a = a | 0;
			b = b | 0;
			c = c | 0;
			zc[a & 7](b | 0, c | 0);
		}
		function sh(a, b) {
			a = a | 0;
			b = b | 0;
			return Ac[a & 31](b | 0) | 0;
		}
		function th(a, b, c, d) {
			a = a | 0;
			b = b | 0;
			c = c | 0;
			d = d | 0;
			return Bc[a & 15](b | 0, c | 0, d | 0) | 0;
		}
		function uh(a, b, c, d) {
			a = a | 0;
			b = b | 0;
			c = c | 0;
			d = d | 0;
			Cc[a & 31](b | 0, c | 0, d | 0);
		}
		function vh(a) {
			a = a | 0;
			Dc[a & 3]();
		}
		function wh(a, b, c, d) {
			a = a | 0;
			b = b | 0;
			c = c | 0;
			d = +d;
			Ec[a & 1](b | 0, c | 0, +d);
		}
		function xh(a, b, c, d, e, f, g) {
			a = a | 0;
			b = b | 0;
			c = c | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			g = g | 0;
			Fc[a & 7](b | 0, c | 0, d | 0, e | 0, f | 0, g | 0);
		}
		function yh(a, b, c) {
			a = a | 0;
			b = b | 0;
			c = c | 0;
			return Gc[a & 15](b | 0, c | 0) | 0;
		}
		function zh(a, b, c, d, e) {
			a = a | 0;
			b = b | 0;
			c = c | 0;
			d = d | 0;
			e = e | 0;
			Hc[a & 7](b | 0, c | 0, d | 0, e | 0);
		}
		function Ah(a, b, c, d) {
			a = a | 0;
			b = b | 0;
			c = c | 0;
			d = d | 0;
			ca(0);
			return 0;
		}
		function Bh(a, b) {
			a = a | 0;
			b = b | 0;
			ca(1);
			return 0;
		}
		function Ch(a, b, c, d, e) {
			a = a | 0;
			b = b | 0;
			c = c | 0;
			d = d | 0;
			e = e | 0;
			ca(2);
		}
		function Dh() {
			ca(3);
			return 0;
		}
		function Eh(a) {
			a = a | 0;
			ca(4);
		}
		function Fh(a, b) {
			a = a | 0;
			b = b | 0;
			ca(5);
		}
		function Gh(a) {
			a = a | 0;
			ca(6);
			return 0;
		}
		function Hh(a, b, c) {
			a = a | 0;
			b = b | 0;
			c = c | 0;
			ca(7);
			return 0;
		}
		function Ih(a, b, c) {
			a = a | 0;
			b = b | 0;
			c = c | 0;
			ca(8);
		}
		function Jh() {
			ca(9);
		}
		function Kh(a, b, c) {
			a = a | 0;
			b = b | 0;
			c = +c;
			ca(10);
		}
		function Lh(a, b, c, d, e, f) {
			a = a | 0;
			b = b | 0;
			c = c | 0;
			d = d | 0;
			e = e | 0;
			f = f | 0;
			ca(11);
		}
		function Mh(a, b) {
			a = a | 0;
			b = b | 0;
			ca(12);
			return 0;
		}
		function Nh(a, b, c, d) {
			a = a | 0;
			b = b | 0;
			c = c | 0;
			d = d | 0;
			ca(13);
		}
		var uc = [Ah, Td, fe, te];
		var vc = [Bh, Uc];
		var wc = [Ch, Hg, Gg, Dg, Bd, Ch, Ch, Ch];
		var xc = [Dh, od, yd, Jd, Xd, je, Dh, Dh];
		var yc = [Eh, dg, eg, lg, pg, mg, ng, og, qg, rg, sg, Tc, _c, fd, md, wd, Hd, Vd, he, Pg, Eh, Eh, Eh, Eh, Eh, Eh, Eh, Eh, Eh, Eh, Eh, Eh];
		var zc = [Fh, Dd, Kd, Yd, ke, Fh, Fh, Fh];
		var Ac = [Gh, fg, Sc, Zc, ed, ld, nd, vd, xd, Gd, Id, Od, Ud, Wd, ae, ge, ie, oe, Gh, Gh, Gh, Gh, Gh, Gh, Gh, Gh, Gh, Gh, Gh, Gh, Gh, Gh];
		var Bc = [Hh, ug, tg, Ag, Rd, Sd, de, ee, re, se, Hh, Hh, Hh, Hh, Hh, Hh];
		var Cc = [Ih, Xc, ad, cd, hd, jd, qd, sd, ud, zd, Ld, Md, Qd, Zd, _d, ce, le, me, qe, Ih, Ih, Ih, Ih, Ih, Ih, Ih, Ih, Ih, Ih, Ih, Ih, Ih];
		var Dc = [Jh, Ng, Og, Jh];
		var Ec = [Kh, Vc];
		var Fc = [Lh, Kg, Jg, Ig, Cd, Lh, Lh, Lh];
		var Gc = [Mh, Wc, $c, bd, gd, id, pd, rd, td, Ed, Pd, be, pe, Mh, Mh, Mh];
		var Hc = [Nh, wg, xg, zg, Ad, Nd, $d, ne];
		return {
			___cxa_can_catch: Lg,
			_free: Rg,
			_memset: Yg,
			___cxa_is_pointer_type: Mg,
			_i64Add: $g,
			_memmove: ch,
			_i64Subtract: Xg,
			_strlen: _g,
			_malloc: Qg,
			_memcpy: bh,
			___getTypeName: Vf,
			_bitshift64Lshr: ah,
			_bitshift64Shl: Zg,
			__GLOBAL__sub_I_voronoi_cpp: Fd,
			__GLOBAL__sub_I_bind_cpp: Xf,
			runPostSets: Wg,
			stackAlloc: Ic,
			stackSave: Jc,
			stackRestore: Kc,
			setThrew: Lc,
			setTempRet0: Oc,
			getTempRet0: Pc,
			dynCall_iiiii: mh,
			dynCall_dii: nh,
			dynCall_viiiii: oh,
			dynCall_i: ph,
			dynCall_vi: qh,
			dynCall_vii: rh,
			dynCall_ii: sh,
			dynCall_iiii: th,
			dynCall_viii: uh,
			dynCall_v: vh,
			dynCall_viid: wh,
			dynCall_viiiiii: xh,
			dynCall_iii: yh,
			dynCall_viiii: zh
		};
	} (Module.asmGlobalArg, Module.asmLibraryArg, buffer);
	var ___cxa_can_catch = Module["___cxa_can_catch"] = asm["___cxa_can_catch"];
	var __GLOBAL__sub_I_bind_cpp = Module["__GLOBAL__sub_I_bind_cpp"] = asm["__GLOBAL__sub_I_bind_cpp"];
	var _free = Module["_free"] = asm["_free"];
	var runPostSets = Module["runPostSets"] = asm["runPostSets"];
	var ___cxa_is_pointer_type = Module["___cxa_is_pointer_type"] = asm["___cxa_is_pointer_type"];
	var _i64Add = Module["_i64Add"] = asm["_i64Add"];
	var _memmove = Module["_memmove"] = asm["_memmove"];
	var _memset = Module["_memset"] = asm["_memset"];
	var _malloc = Module["_malloc"] = asm["_malloc"];
	var _memcpy = Module["_memcpy"] = asm["_memcpy"];
	var _strlen = Module["_strlen"] = asm["_strlen"];
	var __GLOBAL__sub_I_voronoi_cpp = Module["__GLOBAL__sub_I_voronoi_cpp"] = asm["__GLOBAL__sub_I_voronoi_cpp"];
	var _bitshift64Lshr = Module["_bitshift64Lshr"] = asm["_bitshift64Lshr"];
	var ___getTypeName = Module["___getTypeName"] = asm["___getTypeName"];
	var _i64Subtract = Module["_i64Subtract"] = asm["_i64Subtract"];
	var _bitshift64Shl = Module["_bitshift64Shl"] = asm["_bitshift64Shl"];
	var dynCall_iiiii = Module["dynCall_iiiii"] = asm["dynCall_iiiii"];
	var dynCall_dii = Module["dynCall_dii"] = asm["dynCall_dii"];
	var dynCall_viiiii = Module["dynCall_viiiii"] = asm["dynCall_viiiii"];
	var dynCall_i = Module["dynCall_i"] = asm["dynCall_i"];
	var dynCall_vi = Module["dynCall_vi"] = asm["dynCall_vi"];
	var dynCall_vii = Module["dynCall_vii"] = asm["dynCall_vii"];
	var dynCall_ii = Module["dynCall_ii"] = asm["dynCall_ii"];
	var dynCall_iiii = Module["dynCall_iiii"] = asm["dynCall_iiii"];
	var dynCall_viii = Module["dynCall_viii"] = asm["dynCall_viii"];
	var dynCall_v = Module["dynCall_v"] = asm["dynCall_v"];
	var dynCall_viid = Module["dynCall_viid"] = asm["dynCall_viid"];
	var dynCall_viiiiii = Module["dynCall_viiiiii"] = asm["dynCall_viiiiii"];
	var dynCall_iii = Module["dynCall_iii"] = asm["dynCall_iii"];
	var dynCall_viiii = Module["dynCall_viiii"] = asm["dynCall_viiii"];
	Runtime.stackAlloc = asm["stackAlloc"];
	Runtime.stackSave = asm["stackSave"];
	Runtime.stackRestore = asm["stackRestore"];
	Runtime.setTempRet0 = asm["setTempRet0"];
	Runtime.getTempRet0 = asm["getTempRet0"];
	var i64Math = function () {
		var goog = {
			math: {}
		};
		goog.math.Long = function (low, high) {
			this.low_ = low | 0;
			this.high_ = high | 0;
		};
		goog.math.Long.IntCache_ = {};
		goog.math.Long.fromInt = function (value) {
			if (-128 <= value && value < 128) {
				var cachedObj = goog.math.Long.IntCache_[value];
				if (cachedObj) {
					return cachedObj;
				}
			}
			var obj = new goog.math.Long(value | 0, value < 0 ? -1 : 0);
			if (-128 <= value && value < 128) {
				goog.math.Long.IntCache_[value] = obj;
			}
			return obj;
		};
		goog.math.Long.fromNumber = function (value) {
			if (isNaN(value) || !isFinite(value)) {
				return goog.math.Long.ZERO;
			} else if (value <= -goog.math.Long.TWO_PWR_63_DBL_) {
				return goog.math.Long.MIN_VALUE;
			} else if (value + 1 >= goog.math.Long.TWO_PWR_63_DBL_) {
				return goog.math.Long.MAX_VALUE;
			} else if (value < 0) {
				return goog.math.Long.fromNumber(-value).negate();
			} else {
				return new goog.math.Long(value % goog.math.Long.TWO_PWR_32_DBL_ | 0, value / goog.math.Long.TWO_PWR_32_DBL_ | 0);
			}
		};
		goog.math.Long.fromBits = function (lowBits, highBits) {
			return new goog.math.Long(lowBits, highBits);
		};
		goog.math.Long.fromString = function (str, opt_radix) {
			if (str.length == 0) {
				throw Error("number format error: empty string");
			}
			var radix = opt_radix || 10;
			if (radix < 2 || 36 < radix) {
				throw Error("radix out of range: " + radix);
			}
			if (str.charAt(0) == "-") {
				return goog.math.Long.fromString(str.substring(1), radix).negate();
			} else if (str.indexOf("-") >= 0) {
				throw Error('number format error: interior "-" character: ' + str);
			}
			var radixToPower = goog.math.Long.fromNumber(Math.pow(radix, 8));
			var result = goog.math.Long.ZERO;
			for (var i = 0; i < str.length; i += 8) {
				var size = Math.min(8, str.length - i);
				var value = parseInt(str.substring(i, i + size), radix);
				if (size < 8) {
					var power = goog.math.Long.fromNumber(Math.pow(radix, size));
					result = result.multiply(power).add(goog.math.Long.fromNumber(value));
				} else {
					result = result.multiply(radixToPower);
					result = result.add(goog.math.Long.fromNumber(value));
				}
			}
			return result;
		};
		goog.math.Long.TWO_PWR_16_DBL_ = 1 << 16;
		goog.math.Long.TWO_PWR_24_DBL_ = 1 << 24;
		goog.math.Long.TWO_PWR_32_DBL_ = goog.math.Long.TWO_PWR_16_DBL_ * goog.math.Long.TWO_PWR_16_DBL_;
		goog.math.Long.TWO_PWR_31_DBL_ = goog.math.Long.TWO_PWR_32_DBL_ / 2;
		goog.math.Long.TWO_PWR_48_DBL_ = goog.math.Long.TWO_PWR_32_DBL_ * goog.math.Long.TWO_PWR_16_DBL_;
		goog.math.Long.TWO_PWR_64_DBL_ = goog.math.Long.TWO_PWR_32_DBL_ * goog.math.Long.TWO_PWR_32_DBL_;
		goog.math.Long.TWO_PWR_63_DBL_ = goog.math.Long.TWO_PWR_64_DBL_ / 2;
		goog.math.Long.ZERO = goog.math.Long.fromInt(0);
		goog.math.Long.ONE = goog.math.Long.fromInt(1);
		goog.math.Long.NEG_ONE = goog.math.Long.fromInt(-1);
		goog.math.Long.MAX_VALUE = goog.math.Long.fromBits(4294967295 | 0, 2147483647 | 0);
		goog.math.Long.MIN_VALUE = goog.math.Long.fromBits(0, 2147483648 | 0);
		goog.math.Long.TWO_PWR_24_ = goog.math.Long.fromInt(1 << 24);
		goog.math.Long.prototype.toInt = function () {
			return this.low_;
		};
		goog.math.Long.prototype.toNumber = function () {
			return this.high_ * goog.math.Long.TWO_PWR_32_DBL_ + this.getLowBitsUnsigned();
		};
		goog.math.Long.prototype.toString = function (opt_radix) {
			var radix = opt_radix || 10;
			if (radix < 2 || 36 < radix) {
				throw Error("radix out of range: " + radix);
			}
			if (this.isZero()) {
				return "0";
			}
			if (this.isNegative()) {
				if (this.equals(goog.math.Long.MIN_VALUE)) {
					var radixLong = goog.math.Long.fromNumber(radix);
					var div = this.div(radixLong);
					var rem = div.multiply(radixLong).subtract(this);
					return div.toString(radix) + rem.toInt().toString(radix);
				} else {
					return "-" + this.negate().toString(radix);
				}
			}
			var radixToPower = goog.math.Long.fromNumber(Math.pow(radix, 6));
			var rem = this;
			var result = "";
			while (true) {
				var remDiv = rem.div(radixToPower);
				var intval = rem.subtract(remDiv.multiply(radixToPower)).toInt();
				var digits = intval.toString(radix);
				rem = remDiv;
				if (rem.isZero()) {
					return digits + result;
				} else {
					while (digits.length < 6) {
						digits = "0" + digits;
					}
					result = "" + digits + result;
				}
			}
		};
		goog.math.Long.prototype.getHighBits = function () {
			return this.high_;
		};
		goog.math.Long.prototype.getLowBits = function () {
			return this.low_;
		};
		goog.math.Long.prototype.getLowBitsUnsigned = function () {
			return this.low_ >= 0 ? this.low_ : goog.math.Long.TWO_PWR_32_DBL_ + this.low_;
		};
		goog.math.Long.prototype.getNumBitsAbs = function () {
			if (this.isNegative()) {
				if (this.equals(goog.math.Long.MIN_VALUE)) {
					return 64;
				} else {
					return this.negate().getNumBitsAbs();
				}
			} else {
				var val = this.high_ != 0 ? this.high_ : this.low_;
				for (var bit = 31; bit > 0; bit--) {
					if ((val & 1 << bit) != 0) {
						break;
					}
				}
				return this.high_ != 0 ? bit + 33 : bit + 1;
			}
		};
		goog.math.Long.prototype.isZero = function () {
			return this.high_ == 0 && this.low_ == 0;
		};
		goog.math.Long.prototype.isNegative = function () {
			return this.high_ < 0;
		};
		goog.math.Long.prototype.isOdd = function () {
			return (this.low_ & 1) == 1;
		};
		goog.math.Long.prototype.equals = function (other) {
			return this.high_ == other.high_ && this.low_ == other.low_;
		};
		goog.math.Long.prototype.notEquals = function (other) {
			return this.high_ != other.high_ || this.low_ != other.low_;
		};
		goog.math.Long.prototype.lessThan = function (other) {
			return this.compare(other) < 0;
		};
		goog.math.Long.prototype.lessThanOrEqual = function (other) {
			return this.compare(other) <= 0;
		};
		goog.math.Long.prototype.greaterThan = function (other) {
			return this.compare(other) > 0;
		};
		goog.math.Long.prototype.greaterThanOrEqual = function (other) {
			return this.compare(other) >= 0;
		};
		goog.math.Long.prototype.compare = function (other) {
			if (this.equals(other)) {
				return 0;
			}
			var thisNeg = this.isNegative();
			var otherNeg = other.isNegative();
			if (thisNeg && !otherNeg) {
				return -1;
			}
			if (!thisNeg && otherNeg) {
				return 1;
			}
			if (this.subtract(other).isNegative()) {
				return -1;
			} else {
				return 1;
			}
		};
		goog.math.Long.prototype.negate = function () {
			if (this.equals(goog.math.Long.MIN_VALUE)) {
				return goog.math.Long.MIN_VALUE;
			} else {
				return this.not().add(goog.math.Long.ONE);
			}
		};
		goog.math.Long.prototype.add = function (other) {
			var a48 = this.high_ >>> 16;
			var a32 = this.high_ & 65535;
			var a16 = this.low_ >>> 16;
			var a00 = this.low_ & 65535;
			var b48 = other.high_ >>> 16;
			var b32 = other.high_ & 65535;
			var b16 = other.low_ >>> 16;
			var b00 = other.low_ & 65535;
			var c48 = 0, c32 = 0, c16 = 0, c00 = 0;
			c00 += a00 + b00;
			c16 += c00 >>> 16;
			c00 &= 65535;
			c16 += a16 + b16;
			c32 += c16 >>> 16;
			c16 &= 65535;
			c32 += a32 + b32;
			c48 += c32 >>> 16;
			c32 &= 65535;
			c48 += a48 + b48;
			c48 &= 65535;
			return goog.math.Long.fromBits(c16 << 16 | c00, c48 << 16 | c32);
		};
		goog.math.Long.prototype.subtract = function (other) {
			return this.add(other.negate());
		};
		goog.math.Long.prototype.multiply = function (other) {
			if (this.isZero()) {
				return goog.math.Long.ZERO;
			} else if (other.isZero()) {
				return goog.math.Long.ZERO;
			}
			if (this.equals(goog.math.Long.MIN_VALUE)) {
				return other.isOdd() ? goog.math.Long.MIN_VALUE : goog.math.Long.ZERO;
			} else if (other.equals(goog.math.Long.MIN_VALUE)) {
				return this.isOdd() ? goog.math.Long.MIN_VALUE : goog.math.Long.ZERO;
			}
			if (this.isNegative()) {
				if (other.isNegative()) {
					return this.negate().multiply(other.negate());
				} else {
					return this.negate().multiply(other).negate();
				}
			} else if (other.isNegative()) {
				return this.multiply(other.negate()).negate();
			}
			if (this.lessThan(goog.math.Long.TWO_PWR_24_) && other.lessThan(goog.math.Long.TWO_PWR_24_)) {
				return goog.math.Long.fromNumber(this.toNumber() * other.toNumber());
			}
			var a48 = this.high_ >>> 16;
			var a32 = this.high_ & 65535;
			var a16 = this.low_ >>> 16;
			var a00 = this.low_ & 65535;
			var b48 = other.high_ >>> 16;
			var b32 = other.high_ & 65535;
			var b16 = other.low_ >>> 16;
			var b00 = other.low_ & 65535;
			var c48 = 0, c32 = 0, c16 = 0, c00 = 0;
			c00 += a00 * b00;
			c16 += c00 >>> 16;
			c00 &= 65535;
			c16 += a16 * b00;
			c32 += c16 >>> 16;
			c16 &= 65535;
			c16 += a00 * b16;
			c32 += c16 >>> 16;
			c16 &= 65535;
			c32 += a32 * b00;
			c48 += c32 >>> 16;
			c32 &= 65535;
			c32 += a16 * b16;
			c48 += c32 >>> 16;
			c32 &= 65535;
			c32 += a00 * b32;
			c48 += c32 >>> 16;
			c32 &= 65535;
			c48 += a48 * b00 + a32 * b16 + a16 * b32 + a00 * b48;
			c48 &= 65535;
			return goog.math.Long.fromBits(c16 << 16 | c00, c48 << 16 | c32);
		};
		goog.math.Long.prototype.div = function (other) {
			if (other.isZero()) {
				throw Error("division by zero");
			} else if (this.isZero()) {
				return goog.math.Long.ZERO;
			}
			if (this.equals(goog.math.Long.MIN_VALUE)) {
				if (other.equals(goog.math.Long.ONE) || other.equals(goog.math.Long.NEG_ONE)) {
					return goog.math.Long.MIN_VALUE;
				} else if (other.equals(goog.math.Long.MIN_VALUE)) {
					return goog.math.Long.ONE;
				} else {
					var halfThis = this.shiftRight(1);
					var approx = halfThis.div(other).shiftLeft(1);
					if (approx.equals(goog.math.Long.ZERO)) {
						return other.isNegative() ? goog.math.Long.ONE : goog.math.Long.NEG_ONE;
					} else {
						var rem = this.subtract(other.multiply(approx));
						var result = approx.add(rem.div(other));
						return result;
					}
				}
			} else if (other.equals(goog.math.Long.MIN_VALUE)) {
				return goog.math.Long.ZERO;
			}
			if (this.isNegative()) {
				if (other.isNegative()) {
					return this.negate().div(other.negate());
				} else {
					return this.negate().div(other).negate();
				}
			} else if (other.isNegative()) {
				return this.div(other.negate()).negate();
			}
			var res = goog.math.Long.ZERO;
			var rem = this;
			while (rem.greaterThanOrEqual(other)) {
				var approx = Math.max(1, Math.floor(rem.toNumber() / other.toNumber()));
				var log2 = Math.ceil(Math.log(approx) / Math.LN2);
				var delta = log2 <= 48 ? 1 : Math.pow(2, log2 - 48);
				var approxRes = goog.math.Long.fromNumber(approx);
				var approxRem = approxRes.multiply(other);
				while (approxRem.isNegative() || approxRem.greaterThan(rem)) {
					approx -= delta;
					approxRes = goog.math.Long.fromNumber(approx);
					approxRem = approxRes.multiply(other);
				}
				if (approxRes.isZero()) {
					approxRes = goog.math.Long.ONE;
				}
				res = res.add(approxRes);
				rem = rem.subtract(approxRem);
			}
			return res;
		};
		goog.math.Long.prototype.modulo = function (other) {
			return this.subtract(this.div(other).multiply(other));
		};
		goog.math.Long.prototype.not = function () {
			return goog.math.Long.fromBits(~this.low_, ~this.high_);
		};
		goog.math.Long.prototype.and = function (other) {
			return goog.math.Long.fromBits(this.low_ & other.low_, this.high_ & other.high_);
		};
		goog.math.Long.prototype.or = function (other) {
			return goog.math.Long.fromBits(this.low_ | other.low_, this.high_ | other.high_);
		};
		goog.math.Long.prototype.xor = function (other) {
			return goog.math.Long.fromBits(this.low_ ^ other.low_, this.high_ ^ other.high_);
		};
		goog.math.Long.prototype.shiftLeft = function (numBits) {
			numBits &= 63;
			if (numBits == 0) {
				return this;
			} else {
				var low = this.low_;
				if (numBits < 32) {
					var high = this.high_;
					return goog.math.Long.fromBits(low << numBits, high << numBits | low >>> 32 - numBits);
				} else {
					return goog.math.Long.fromBits(0, low << numBits - 32);
				}
			}
		};
		goog.math.Long.prototype.shiftRight = function (numBits) {
			numBits &= 63;
			if (numBits == 0) {
				return this;
			} else {
				var high = this.high_;
				if (numBits < 32) {
					var low = this.low_;
					return goog.math.Long.fromBits(low >>> numBits | high << 32 - numBits, high >> numBits);
				} else {
					return goog.math.Long.fromBits(high >> numBits - 32, high >= 0 ? 0 : -1);
				}
			}
		};
		goog.math.Long.prototype.shiftRightUnsigned = function (numBits) {
			numBits &= 63;
			if (numBits == 0) {
				return this;
			} else {
				var high = this.high_;
				if (numBits < 32) {
					var low = this.low_;
					return goog.math.Long.fromBits(low >>> numBits | high << 32 - numBits, high >>> numBits);
				} else if (numBits == 32) {
					return goog.math.Long.fromBits(high, 0);
				} else {
					return goog.math.Long.fromBits(high >>> numBits - 32, 0);
				}
			}
		};
		var navigator = {
			appName: "Modern Browser"
		};
		var dbits;
		var canary = 0xdeadbeefcafe;
		var j_lm = (canary & 16777215) == 15715070;
		function BigInteger(a, b, c) {
			if (a != null) if ("number" == typeof a) this.fromNumber(a, b, c); else if (b == null && "string" != typeof a) this.fromString(a, 256); else this.fromString(a, b);
		}
		function nbi() {
			return new BigInteger(null);
		}
		function am1(i, x, w, j, c, n) {
			while (--n >= 0) {
				var v = x * this[i++] + w[j] + c;
				c = Math.floor(v / 67108864);
				w[j++] = v & 67108863;
			}
			return c;
		}
		function am2(i, x, w, j, c, n) {
			var xl = x & 32767, xh = x >> 15;
			while (--n >= 0) {
				var l = this[i] & 32767;
				var h = this[i++] >> 15;
				var m = xh * l + h * xl;
				l = xl * l + ((m & 32767) << 15) + w[j] + (c & 1073741823);
				c = (l >>> 30) + (m >>> 15) + xh * h + (c >>> 30);
				w[j++] = l & 1073741823;
			}
			return c;
		}
		function am3(i, x, w, j, c, n) {
			var xl = x & 16383, xh = x >> 14;
			while (--n >= 0) {
				var l = this[i] & 16383;
				var h = this[i++] >> 14;
				var m = xh * l + h * xl;
				l = xl * l + ((m & 16383) << 14) + w[j] + c;
				c = (l >> 28) + (m >> 14) + xh * h;
				w[j++] = l & 268435455;
			}
			return c;
		}
		if (j_lm && navigator.appName == "Microsoft Internet Explorer") {
			BigInteger.prototype.am = am2;
			dbits = 30;
		} else if (j_lm && navigator.appName != "Netscape") {
			BigInteger.prototype.am = am1;
			dbits = 26;
		} else {
			BigInteger.prototype.am = am3;
			dbits = 28;
		}
		BigInteger.prototype.DB = dbits;
		BigInteger.prototype.DM = (1 << dbits) - 1;
		BigInteger.prototype.DV = 1 << dbits;
		var BI_FP = 52;
		BigInteger.prototype.FV = Math.pow(2, BI_FP);
		BigInteger.prototype.F1 = BI_FP - dbits;
		BigInteger.prototype.F2 = 2 * dbits - BI_FP;
		var BI_RM = "0123456789abcdefghijklmnopqrstuvwxyz";
		var BI_RC = new Array();
		var rr, vv;
		rr = "0".charCodeAt(0);
		for (vv = 0; vv <= 9; ++vv) BI_RC[rr++] = vv;
		rr = "a".charCodeAt(0);
		for (vv = 10; vv < 36; ++vv) BI_RC[rr++] = vv;
		rr = "A".charCodeAt(0);
		for (vv = 10; vv < 36; ++vv) BI_RC[rr++] = vv;
		function int2char(n) {
			return BI_RM.charAt(n);
		}
		function intAt(s, i) {
			var c = BI_RC[s.charCodeAt(i)];
			return c == null ? -1 : c;
		}
		function bnpCopyTo(r) {
			for (var i = this.t - 1; i >= 0; --i) r[i] = this[i];
			r.t = this.t;
			r.s = this.s;
		}
		function bnpFromInt(x) {
			this.t = 1;
			this.s = x < 0 ? -1 : 0;
			if (x > 0) this[0] = x; else if (x < -1) this[0] = x + DV; else this.t = 0;
		}
		function nbv(i) {
			var r = nbi();
			r.fromInt(i);
			return r;
		}
		function bnpFromString(s, b) {
			var k;
			if (b == 16) k = 4; else if (b == 8) k = 3; else if (b == 256) k = 8; else if (b == 2) k = 1; else if (b == 32) k = 5; else if (b == 4) k = 2; else {
				this.fromRadix(s, b);
				return;
			}
			this.t = 0;
			this.s = 0;
			var i = s.length, mi = false, sh = 0;
			while (--i >= 0) {
				var x = k == 8 ? s[i] & 255 : intAt(s, i);
				if (x < 0) {
					if (s.charAt(i) == "-") mi = true;
					continue;
				}
				mi = false;
				if (sh == 0) this[this.t++] = x; else if (sh + k > this.DB) {
					this[this.t - 1] |= (x & (1 << this.DB - sh) - 1) << sh;
					this[this.t++] = x >> this.DB - sh;
				} else this[this.t - 1] |= x << sh;
				sh += k;
				if (sh >= this.DB) sh -= this.DB;
			}
			if (k == 8 && (s[0] & 128) != 0) {
				this.s = -1;
				if (sh > 0) this[this.t - 1] |= (1 << this.DB - sh) - 1 << sh;
			}
			this.clamp();
			if (mi) BigInteger.ZERO.subTo(this, this);
		}
		function bnpClamp() {
			var c = this.s & this.DM;
			while (this.t > 0 && this[this.t - 1] == c)--this.t;
		}
		function bnToString(b) {
			if (this.s < 0) return "-" + this.negate().toString(b);
			var k;
			if (b == 16) k = 4; else if (b == 8) k = 3; else if (b == 2) k = 1; else if (b == 32) k = 5; else if (b == 4) k = 2; else return this.toRadix(b);
			var km = (1 << k) - 1, d, m = false, r = "", i = this.t;
			var p = this.DB - i * this.DB % k;
			if (i-- > 0) {
				if (p < this.DB && (d = this[i] >> p) > 0) {
					m = true;
					r = int2char(d);
				}
				while (i >= 0) {
					if (p < k) {
						d = (this[i] & (1 << p) - 1) << k - p;
						d |= this[--i] >> (p += this.DB - k);
					} else {
						d = this[i] >> (p -= k) & km;
						if (p <= 0) {
							p += this.DB;
							--i;
						}
					}
					if (d > 0) m = true;
					if (m) r += int2char(d);
				}
			}
			return m ? r : "0";
		}
		function bnNegate() {
			var r = nbi();
			BigInteger.ZERO.subTo(this, r);
			return r;
		}
		function bnAbs() {
			return this.s < 0 ? this.negate() : this;
		}
		function bnCompareTo(a) {
			var r = this.s - a.s;
			if (r != 0) return r;
			var i = this.t;
			r = i - a.t;
			if (r != 0) return this.s < 0 ? -r : r;
			while (--i >= 0) if ((r = this[i] - a[i]) != 0) return r;
			return 0;
		}
		function nbits(x) {
			var r = 1, t;
			if ((t = x >>> 16) != 0) {
				x = t;
				r += 16;
			}
			if ((t = x >> 8) != 0) {
				x = t;
				r += 8;
			}
			if ((t = x >> 4) != 0) {
				x = t;
				r += 4;
			}
			if ((t = x >> 2) != 0) {
				x = t;
				r += 2;
			}
			if ((t = x >> 1) != 0) {
				x = t;
				r += 1;
			}
			return r;
		}
		function bnBitLength() {
			if (this.t <= 0) return 0;
			return this.DB * (this.t - 1) + nbits(this[this.t - 1] ^ this.s & this.DM);
		}
		function bnpDLShiftTo(n, r) {
			var i;
			for (i = this.t - 1; i >= 0; --i) r[i + n] = this[i];
			for (i = n - 1; i >= 0; --i) r[i] = 0;
			r.t = this.t + n;
			r.s = this.s;
		}
		function bnpDRShiftTo(n, r) {
			for (var i = n; i < this.t; ++i) r[i - n] = this[i];
			r.t = Math.max(this.t - n, 0);
			r.s = this.s;
		}
		function bnpLShiftTo(n, r) {
			var bs = n % this.DB;
			var cbs = this.DB - bs;
			var bm = (1 << cbs) - 1;
			var ds = Math.floor(n / this.DB), c = this.s << bs & this.DM, i;
			for (i = this.t - 1; i >= 0; --i) {
				r[i + ds + 1] = this[i] >> cbs | c;
				c = (this[i] & bm) << bs;
			}
			for (i = ds - 1; i >= 0; --i) r[i] = 0;
			r[ds] = c;
			r.t = this.t + ds + 1;
			r.s = this.s;
			r.clamp();
		}
		function bnpRShiftTo(n, r) {
			r.s = this.s;
			var ds = Math.floor(n / this.DB);
			if (ds >= this.t) {
				r.t = 0;
				return;
			}
			var bs = n % this.DB;
			var cbs = this.DB - bs;
			var bm = (1 << bs) - 1;
			r[0] = this[ds] >> bs;
			for (var i = ds + 1; i < this.t; ++i) {
				r[i - ds - 1] |= (this[i] & bm) << cbs;
				r[i - ds] = this[i] >> bs;
			}
			if (bs > 0) r[this.t - ds - 1] |= (this.s & bm) << cbs;
			r.t = this.t - ds;
			r.clamp();
		}
		function bnpSubTo(a, r) {
			var i = 0, c = 0, m = Math.min(a.t, this.t);
			while (i < m) {
				c += this[i] - a[i];
				r[i++] = c & this.DM;
				c >>= this.DB;
			}
			if (a.t < this.t) {
				c -= a.s;
				while (i < this.t) {
					c += this[i];
					r[i++] = c & this.DM;
					c >>= this.DB;
				}
				c += this.s;
			} else {
				c += this.s;
				while (i < a.t) {
					c -= a[i];
					r[i++] = c & this.DM;
					c >>= this.DB;
				}
				c -= a.s;
			}
			r.s = c < 0 ? -1 : 0;
			if (c < -1) r[i++] = this.DV + c; else if (c > 0) r[i++] = c;
			r.t = i;
			r.clamp();
		}
		function bnpMultiplyTo(a, r) {
			var x = this.abs(), y = a.abs();
			var i = x.t;
			r.t = i + y.t;
			while (--i >= 0) r[i] = 0;
			for (i = 0; i < y.t; ++i) r[i + x.t] = x.am(0, y[i], r, i, 0, x.t);
			r.s = 0;
			r.clamp();
			if (this.s != a.s) BigInteger.ZERO.subTo(r, r);
		}
		function bnpSquareTo(r) {
			var x = this.abs();
			var i = r.t = 2 * x.t;
			while (--i >= 0) r[i] = 0;
			for (i = 0; i < x.t - 1; ++i) {
				var c = x.am(i, x[i], r, 2 * i, 0, 1);
				if ((r[i + x.t] += x.am(i + 1, 2 * x[i], r, 2 * i + 1, c, x.t - i - 1)) >= x.DV) {
					r[i + x.t] -= x.DV;
					r[i + x.t + 1] = 1;
				}
			}
			if (r.t > 0) r[r.t - 1] += x.am(i, x[i], r, 2 * i, 0, 1);
			r.s = 0;
			r.clamp();
		}
		function bnpDivRemTo(m, q, r) {
			var pm = m.abs();
			if (pm.t <= 0) return;
			var pt = this.abs();
			if (pt.t < pm.t) {
				if (q != null) q.fromInt(0);
				if (r != null) this.copyTo(r);
				return;
			}
			if (r == null) r = nbi();
			var y = nbi(), ts = this.s, ms = m.s;
			var nsh = this.DB - nbits(pm[pm.t - 1]);
			if (nsh > 0) {
				pm.lShiftTo(nsh, y);
				pt.lShiftTo(nsh, r);
			} else {
				pm.copyTo(y);
				pt.copyTo(r);
			}
			var ys = y.t;
			var y0 = y[ys - 1];
			if (y0 == 0) return;
			var yt = y0 * (1 << this.F1) + (ys > 1 ? y[ys - 2] >> this.F2 : 0);
			var d1 = this.FV / yt, d2 = (1 << this.F1) / yt, e = 1 << this.F2;
			var i = r.t, j = i - ys, t = q == null ? nbi() : q;
			y.dlShiftTo(j, t);
			if (r.compareTo(t) >= 0) {
				r[r.t++] = 1;
				r.subTo(t, r);
			}
			BigInteger.ONE.dlShiftTo(ys, t);
			t.subTo(y, y);
			while (y.t < ys) y[y.t++] = 0;
			while (--j >= 0) {
				var qd = r[--i] == y0 ? this.DM : Math.floor(r[i] * d1 + (r[i - 1] + e) * d2);
				if ((r[i] += y.am(0, qd, r, j, 0, ys)) < qd) {
					y.dlShiftTo(j, t);
					r.subTo(t, r);
					while (r[i] < --qd) r.subTo(t, r);
				}
			}
			if (q != null) {
				r.drShiftTo(ys, q);
				if (ts != ms) BigInteger.ZERO.subTo(q, q);
			}
			r.t = ys;
			r.clamp();
			if (nsh > 0) r.rShiftTo(nsh, r);
			if (ts < 0) BigInteger.ZERO.subTo(r, r);
		}
		function bnMod(a) {
			var r = nbi();
			this.abs().divRemTo(a, null, r);
			if (this.s < 0 && r.compareTo(BigInteger.ZERO) > 0) a.subTo(r, r);
			return r;
		}
		function Classic(m) {
			this.m = m;
		}
		function cConvert(x) {
			if (x.s < 0 || x.compareTo(this.m) >= 0) return x.mod(this.m); else return x;
		}
		function cRevert(x) {
			return x;
		}
		function cReduce(x) {
			x.divRemTo(this.m, null, x);
		}
		function cMulTo(x, y, r) {
			x.multiplyTo(y, r);
			this.reduce(r);
		}
		function cSqrTo(x, r) {
			x.squareTo(r);
			this.reduce(r);
		}
		Classic.prototype.convert = cConvert;
		Classic.prototype.revert = cRevert;
		Classic.prototype.reduce = cReduce;
		Classic.prototype.mulTo = cMulTo;
		Classic.prototype.sqrTo = cSqrTo;
		function bnpInvDigit() {
			if (this.t < 1) return 0;
			var x = this[0];
			if ((x & 1) == 0) return 0;
			var y = x & 3;
			y = y * (2 - (x & 15) * y) & 15;
			y = y * (2 - (x & 255) * y) & 255;
			y = y * (2 - ((x & 65535) * y & 65535)) & 65535;
			y = y * (2 - x * y % this.DV) % this.DV;
			return y > 0 ? this.DV - y : -y;
		}
		function Montgomery(m) {
			this.m = m;
			this.mp = m.invDigit();
			this.mpl = this.mp & 32767;
			this.mph = this.mp >> 15;
			this.um = (1 << m.DB - 15) - 1;
			this.mt2 = 2 * m.t;
		}
		function montConvert(x) {
			var r = nbi();
			x.abs().dlShiftTo(this.m.t, r);
			r.divRemTo(this.m, null, r);
			if (x.s < 0 && r.compareTo(BigInteger.ZERO) > 0) this.m.subTo(r, r);
			return r;
		}
		function montRevert(x) {
			var r = nbi();
			x.copyTo(r);
			this.reduce(r);
			return r;
		}
		function montReduce(x) {
			while (x.t <= this.mt2) x[x.t++] = 0;
			for (var i = 0; i < this.m.t; ++i) {
				var j = x[i] & 32767;
				var u0 = j * this.mpl + ((j * this.mph + (x[i] >> 15) * this.mpl & this.um) << 15) & x.DM;
				j = i + this.m.t;
				x[j] += this.m.am(0, u0, x, i, 0, this.m.t);
				while (x[j] >= x.DV) {
					x[j] -= x.DV;
					x[++j]++;
				}
			}
			x.clamp();
			x.drShiftTo(this.m.t, x);
			if (x.compareTo(this.m) >= 0) x.subTo(this.m, x);
		}
		function montSqrTo(x, r) {
			x.squareTo(r);
			this.reduce(r);
		}
		function montMulTo(x, y, r) {
			x.multiplyTo(y, r);
			this.reduce(r);
		}
		Montgomery.prototype.convert = montConvert;
		Montgomery.prototype.revert = montRevert;
		Montgomery.prototype.reduce = montReduce;
		Montgomery.prototype.mulTo = montMulTo;
		Montgomery.prototype.sqrTo = montSqrTo;
		function bnpIsEven() {
			return (this.t > 0 ? this[0] & 1 : this.s) == 0;
		}
		function bnpExp(e, z) {
			if (e > 4294967295 || e < 1) return BigInteger.ONE;
			var r = nbi(), r2 = nbi(), g = z.convert(this), i = nbits(e) - 1;
			g.copyTo(r);
			while (--i >= 0) {
				z.sqrTo(r, r2);
				if ((e & 1 << i) > 0) z.mulTo(r2, g, r); else {
					var t = r;
					r = r2;
					r2 = t;
				}
			}
			return z.revert(r);
		}
		function bnModPowInt(e, m) {
			var z;
			if (e < 256 || m.isEven()) z = new Classic(m); else z = new Montgomery(m);
			return this.exp(e, z);
		}
		BigInteger.prototype.copyTo = bnpCopyTo;
		BigInteger.prototype.fromInt = bnpFromInt;
		BigInteger.prototype.fromString = bnpFromString;
		BigInteger.prototype.clamp = bnpClamp;
		BigInteger.prototype.dlShiftTo = bnpDLShiftTo;
		BigInteger.prototype.drShiftTo = bnpDRShiftTo;
		BigInteger.prototype.lShiftTo = bnpLShiftTo;
		BigInteger.prototype.rShiftTo = bnpRShiftTo;
		BigInteger.prototype.subTo = bnpSubTo;
		BigInteger.prototype.multiplyTo = bnpMultiplyTo;
		BigInteger.prototype.squareTo = bnpSquareTo;
		BigInteger.prototype.divRemTo = bnpDivRemTo;
		BigInteger.prototype.invDigit = bnpInvDigit;
		BigInteger.prototype.isEven = bnpIsEven;
		BigInteger.prototype.exp = bnpExp;
		BigInteger.prototype.toString = bnToString;
		BigInteger.prototype.negate = bnNegate;
		BigInteger.prototype.abs = bnAbs;
		BigInteger.prototype.compareTo = bnCompareTo;
		BigInteger.prototype.bitLength = bnBitLength;
		BigInteger.prototype.mod = bnMod;
		BigInteger.prototype.modPowInt = bnModPowInt;
		BigInteger.ZERO = nbv(0);
		BigInteger.ONE = nbv(1);
		function bnpFromRadix(s, b) {
			this.fromInt(0);
			if (b == null) b = 10;
			var cs = this.chunkSize(b);
			var d = Math.pow(b, cs), mi = false, j = 0, w = 0;
			for (var i = 0; i < s.length; ++i) {
				var x = intAt(s, i);
				if (x < 0) {
					if (s.charAt(i) == "-" && this.signum() == 0) mi = true;
					continue;
				}
				w = b * w + x;
				if (++j >= cs) {
					this.dMultiply(d);
					this.dAddOffset(w, 0);
					j = 0;
					w = 0;
				}
			}
			if (j > 0) {
				this.dMultiply(Math.pow(b, j));
				this.dAddOffset(w, 0);
			}
			if (mi) BigInteger.ZERO.subTo(this, this);
		}
		function bnpChunkSize(r) {
			return Math.floor(Math.LN2 * this.DB / Math.log(r));
		}
		function bnSigNum() {
			if (this.s < 0) return -1; else if (this.t <= 0 || this.t == 1 && this[0] <= 0) return 0; else return 1;
		}
		function bnpDMultiply(n) {
			this[this.t] = this.am(0, n - 1, this, 0, 0, this.t);
			++this.t;
			this.clamp();
		}
		function bnpDAddOffset(n, w) {
			if (n == 0) return;
			while (this.t <= w) this[this.t++] = 0;
			this[w] += n;
			while (this[w] >= this.DV) {
				this[w] -= this.DV;
				if (++w >= this.t) this[this.t++] = 0;
				++this[w];
			}
		}
		function bnpToRadix(b) {
			if (b == null) b = 10;
			if (this.signum() == 0 || b < 2 || b > 36) return "0";
			var cs = this.chunkSize(b);
			var a = Math.pow(b, cs);
			var d = nbv(a), y = nbi(), z = nbi(), r = "";
			this.divRemTo(d, y, z);
			while (y.signum() > 0) {
				r = (a + z.intValue()).toString(b).substr(1) + r;
				y.divRemTo(d, y, z);
			}
			return z.intValue().toString(b) + r;
		}
		function bnIntValue() {
			if (this.s < 0) {
				if (this.t == 1) return this[0] - this.DV; else if (this.t == 0) return -1;
			} else if (this.t == 1) return this[0]; else if (this.t == 0) return 0;
			return (this[1] & (1 << 32 - this.DB) - 1) << this.DB | this[0];
		}
		function bnpAddTo(a, r) {
			var i = 0, c = 0, m = Math.min(a.t, this.t);
			while (i < m) {
				c += this[i] + a[i];
				r[i++] = c & this.DM;
				c >>= this.DB;
			}
			if (a.t < this.t) {
				c += a.s;
				while (i < this.t) {
					c += this[i];
					r[i++] = c & this.DM;
					c >>= this.DB;
				}
				c += this.s;
			} else {
				c += this.s;
				while (i < a.t) {
					c += a[i];
					r[i++] = c & this.DM;
					c >>= this.DB;
				}
				c += a.s;
			}
			r.s = c < 0 ? -1 : 0;
			if (c > 0) r[i++] = c; else if (c < -1) r[i++] = this.DV + c;
			r.t = i;
			r.clamp();
		}
		BigInteger.prototype.fromRadix = bnpFromRadix;
		BigInteger.prototype.chunkSize = bnpChunkSize;
		BigInteger.prototype.signum = bnSigNum;
		BigInteger.prototype.dMultiply = bnpDMultiply;
		BigInteger.prototype.dAddOffset = bnpDAddOffset;
		BigInteger.prototype.toRadix = bnpToRadix;
		BigInteger.prototype.intValue = bnIntValue;
		BigInteger.prototype.addTo = bnpAddTo;
		var Wrapper = {
			abs: function (l, h) {
				var x = new goog.math.Long(l, h);
				var ret;
				if (x.isNegative()) {
					ret = x.negate();
				} else {
					ret = x;
				}
				HEAP32[tempDoublePtr >> 2] = ret.low_;
				HEAP32[tempDoublePtr + 4 >> 2] = ret.high_;
			},
			ensureTemps: function () {
				if (Wrapper.ensuredTemps) return;
				Wrapper.ensuredTemps = true;
				Wrapper.two32 = new BigInteger();
				Wrapper.two32.fromString("4294967296", 10);
				Wrapper.two64 = new BigInteger();
				Wrapper.two64.fromString("18446744073709551616", 10);
				Wrapper.temp1 = new BigInteger();
				Wrapper.temp2 = new BigInteger();
			},
			lh2bignum: function (l, h) {
				var a = new BigInteger();
				a.fromString(h.toString(), 10);
				var b = new BigInteger();
				a.multiplyTo(Wrapper.two32, b);
				var c = new BigInteger();
				c.fromString(l.toString(), 10);
				var d = new BigInteger();
				c.addTo(b, d);
				return d;
			},
			stringify: function (l, h, unsigned) {
				var ret = new goog.math.Long(l, h).toString();
				if (unsigned && ret[0] == "-") {
					Wrapper.ensureTemps();
					var bignum = new BigInteger();
					bignum.fromString(ret, 10);
					ret = new BigInteger();
					Wrapper.two64.addTo(bignum, ret);
					ret = ret.toString(10);
				}
				return ret;
			},
			fromString: function (str, base, min, max, unsigned) {
				Wrapper.ensureTemps();
				var bignum = new BigInteger();
				bignum.fromString(str, base);
				var bigmin = new BigInteger();
				bigmin.fromString(min, 10);
				var bigmax = new BigInteger();
				bigmax.fromString(max, 10);
				if (unsigned && bignum.compareTo(BigInteger.ZERO) < 0) {
					var temp = new BigInteger();
					bignum.addTo(Wrapper.two64, temp);
					bignum = temp;
				}
				var error = false;
				if (bignum.compareTo(bigmin) < 0) {
					bignum = bigmin;
					error = true;
				} else if (bignum.compareTo(bigmax) > 0) {
					bignum = bigmax;
					error = true;
				}
				var ret = goog.math.Long.fromString(bignum.toString());
				HEAP32[tempDoublePtr >> 2] = ret.low_;
				HEAP32[tempDoublePtr + 4 >> 2] = ret.high_;
				if (error) throw "range error";
			}
		};
		return Wrapper;
	} ();
	if (memoryInitializer) {
		if (typeof Module["locateFile"] === "function") {
			memoryInitializer = Module["locateFile"](memoryInitializer);
		} else if (Module["memoryInitializerPrefixURL"]) {
			memoryInitializer = Module["memoryInitializerPrefixURL"] + memoryInitializer;
		}
		if (ENVIRONMENT_IS_NODE || ENVIRONMENT_IS_SHELL) {
			var data = Module["readBinary"](memoryInitializer);
			HEAPU8.set(data, STATIC_BASE);
		} else {
			addRunDependency("memory initializer");
			var applyMemoryInitializer = function (data) {
				if (data.byteLength) data = new Uint8Array(data);
				HEAPU8.set(data, STATIC_BASE);
				removeRunDependency("memory initializer");
			};
			var request = Module["memoryInitializerRequest"];
			if (request) {
				if (request.response) {
					setTimeout(function () {
						applyMemoryInitializer(request.response);
					}, 0);
				} else {
					request.addEventListener("load", function () {
						if (request.status !== 200 && request.status !== 0) {
							console.warn("a problem seems to have happened with Module.memoryInitializerRequest, status: " + request.status);
						}
						if (!request.response || typeof request.response !== "object" || !request.response.byteLength) {
							console.warn("a problem seems to have happened with Module.memoryInitializerRequest response (expected ArrayBuffer): " + request.response);
						}
						applyMemoryInitializer(request.response);
					});
				}
			} else {
				Browser.asyncLoad(memoryInitializer, applyMemoryInitializer, function () {
					throw "could not load memory initializer " + memoryInitializer;
				});
			}
		}
	}
	function ExitStatus(status) {
		this.name = "ExitStatus";
		this.message = "Program terminated with exit(" + status + ")";
		this.status = status;
	}
	ExitStatus.prototype = new Error();
	ExitStatus.prototype.constructor = ExitStatus;
	var initialStackTop;
	var preloadStartTime = null;
	var calledMain = false;
	dependenciesFulfilled = function runCaller() {
		if (!Module["calledRun"]) run();
		if (!Module["calledRun"]) dependenciesFulfilled = runCaller;
	};
	Module["callMain"] = Module.callMain = function callMain(args) {
		assert(runDependencies == 0, "cannot call main when async dependencies remain! (listen on __ATMAIN__)");
		assert(__ATPRERUN__.length == 0, "cannot call main when preRun functions remain to be called");
		args = args || [];
		ensureInitRuntime();
		var argc = args.length + 1;
		function pad() {
			for (var i = 0; i < 4 - 1; i++) {
				argv.push(0);
			}
		}
		var argv = [allocate(intArrayFromString(Module["thisProgram"]), "i8", ALLOC_NORMAL)];
		pad();
		for (var i = 0; i < argc - 1; i = i + 1) {
			argv.push(allocate(intArrayFromString(args[i]), "i8", ALLOC_NORMAL));
			pad();
		}
		argv.push(0);
		argv = allocate(argv, "i32", ALLOC_NORMAL);
		initialStackTop = STACKTOP;
		try {
			var ret = Module["_main"](argc, argv, 0);
			exit(ret, true);
		} catch (e) {
			if (e instanceof ExitStatus) {
				return;
			} else if (e == "SimulateInfiniteLoop") {
				Module["noExitRuntime"] = true;
				return;
			} else {
				if (e && typeof e === "object" && e.stack) Module.printErr("exception thrown: " + [e, e.stack]);
				throw e;
			}
		} finally {
			calledMain = true;
		}
	};
	function run(args) {
		args = args || Module["arguments"];
		if (preloadStartTime === null) preloadStartTime = Date.now();
		if (runDependencies > 0) {
			return;
		}
		preRun();
		if (runDependencies > 0) return;
		if (Module["calledRun"]) return;
		function doRun() {
			if (Module["calledRun"]) return;
			Module["calledRun"] = true;
			if (ABORT) return;
			ensureInitRuntime();
			preMain();
			if (ENVIRONMENT_IS_WEB && preloadStartTime !== null) {
				Module.printErr("pre-main prep time: " + (Date.now() - preloadStartTime) + " ms");
			}
			if (Module["onRuntimeInitialized"]) Module["onRuntimeInitialized"]();
			if (Module["_main"] && shouldRunNow) Module["callMain"](args);
			postRun();
		}
		if (Module["setStatus"]) {
			Module["setStatus"]("Running...");
			setTimeout(function () {
				setTimeout(function () {
					Module["setStatus"]("");
				}, 1);
				doRun();
			}, 1);
		} else {
			doRun();
		}
	}
	Module["run"] = Module.run = run;
	function exit(status, implicit) {
		if (implicit && Module["noExitRuntime"]) {
			return;
		}
		if (Module["noExitRuntime"]) { } else {
			ABORT = true;
			EXITSTATUS = status;
			STACKTOP = initialStackTop;
			exitRuntime();
			if (Module["onExit"]) Module["onExit"](status);
		}
		if (ENVIRONMENT_IS_NODE) {
			process["stdout"]["once"]("drain", function () {
				process["exit"](status);
			});
			console.log(" ");
			setTimeout(function () {
				process["exit"](status);
			}, 500);
		} else if (ENVIRONMENT_IS_SHELL && typeof quit === "function") {
			quit(status);
		}
		throw new ExitStatus(status);
	}
	Module["exit"] = Module.exit = exit;
	var abortDecorators = [];
	function abort(what) {
		if (what !== undefined) {
			Module.print(what);
			Module.printErr(what);
			what = JSON.stringify(what);
		} else {
			what = "";
		}
		ABORT = true;
		EXITSTATUS = 1;
		var extra = "\nIf this abort() is unexpected, build with -s ASSERTIONS=1 which can give more information.";
		var output = "abort(" + what + ") at " + stackTrace() + extra;
		abortDecorators.forEach(function (decorator) {
			output = decorator(output, what);
		});
		throw output;
	}
	Module["abort"] = Module.abort = abort;
	if (Module["preInit"]) {
		if (typeof Module["preInit"] == "function") Module["preInit"] = [Module["preInit"]];
		while (Module["preInit"].length > 0) {
			Module["preInit"].pop()();
		}
	}
	var shouldRunNow = true;
	if (Module["noInitialRun"]) {
		shouldRunNow = false;
	}
	run();
	return Module;
} ();