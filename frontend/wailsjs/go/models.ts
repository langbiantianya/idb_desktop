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

