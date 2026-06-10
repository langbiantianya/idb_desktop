export namespace main {
	
	export class AppSettings {
	    version: number;
	    locale: string;
	    setupComplete: boolean;
	    themeMode: string;
	    lightThemeId: string;
	    darkThemeId: string;
	    memRefreshSeconds: number;
	    JvmMaxMemoryMB: number;
	    systemMemoryMB: number;
	
	    static createFrom(source: any = {}) {
	        return new AppSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.locale = source["locale"];
	        this.setupComplete = source["setupComplete"];
	        this.themeMode = source["themeMode"];
	        this.lightThemeId = source["lightThemeId"];
	        this.darkThemeId = source["darkThemeId"];
	        this.memRefreshSeconds = source["memRefreshSeconds"];
	        this.JvmMaxMemoryMB = source["JvmMaxMemoryMB"];
	        this.systemMemoryMB = source["systemMemoryMB"];
	    }
	}
	export class GoRuntimeInfo {
	    goVersion: string;
	    goroutines: number;
	    alloc: number;
	    sys: number;
	    heapInuse: number;
	    heapIdle: number;
	    stackInuse: number;
	    numGC: number;
	
	    static createFrom(source: any = {}) {
	        return new GoRuntimeInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.goVersion = source["goVersion"];
	        this.goroutines = source["goroutines"];
	        this.alloc = source["alloc"];
	        this.sys = source["sys"];
	        this.heapInuse = source["heapInuse"];
	        this.heapIdle = source["heapIdle"];
	        this.stackInuse = source["stackInuse"];
	        this.numGC = source["numGC"];
	    }
	}
	export class WebViewInfo {
	    processName: string;
	    description: string;
	    workingSetSize: number;
	
	    static createFrom(source: any = {}) {
	        return new WebViewInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.processName = source["processName"];
	        this.description = source["description"];
	        this.workingSetSize = source["workingSetSize"];
	    }
	}
	export class RuntimeInfo {
	    go: GoRuntimeInfo;
	    webview: WebViewInfo;
	
	    static createFrom(source: any = {}) {
	        return new RuntimeInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.go = this.convertValues(source["go"], GoRuntimeInfo);
	        this.webview = this.convertValues(source["webview"], WebViewInfo);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SaveConnectionInput {
	    id: string;
	    name: string;
	    driver: string;
	    host: string;
	    port: number;
	    user: string;
	    password: string;
	    database: string;
	    savePassword: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SaveConnectionInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.driver = source["driver"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.password = source["password"];
	        this.database = source["database"];
	        this.savePassword = source["savePassword"];
	    }
	}
	export class SavedConnection {
	    id: string;
	    name: string;
	    driver: string;
	    host: string;
	    port: number;
	    user: string;
	    database: string;
	    hasPassword: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SavedConnection(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.driver = source["driver"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.database = source["database"];
	        this.hasPassword = source["hasPassword"];
	    }
	}
	export class ThemeInfo {
	    id: string;
	    name: string;
	    type: string;
	
	    static createFrom(source: any = {}) {
	        return new ThemeInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.type = source["type"];
	    }
	}

}

