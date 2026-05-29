export namespace main {
	
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

}

