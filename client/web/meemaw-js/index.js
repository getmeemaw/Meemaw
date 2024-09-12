import './wasm_exec.js';

const localStorageKeys = {
    dkgResult: 'dkgResult',
    address: 'address',
    metadata: 'metadata'
};

export class Wallet {
    constructor(host, dkgResult, metadata, address, authData) {
        this.host = host;
        this.dkgResult = dkgResult;
        this.metadata = metadata;
        this.address = address;
        this.authData = authData;
    }

    From() {
        return this.address;
    }


    // SignEthTransaction signs an Ethereum transaction (formatted as a json of parameters) using TSS
    async SignEthTransaction(raw, chainId) {

        let signedTx = ""

        try {
            signedTx = await window.SignEthTransaction(this.host, JSON.stringify(raw), this.dkgResult, this.metadata, this.authData, String(chainId));
        } catch (error) {
            console.error("SignEthTransaction - error:", error)
            throw error;
        }

        return "0x"+signedTx;
    }

    // SignBytes signs hex encoded bytes using TSS
    async SignBytes(raw) {

        if (!(/^0x[0-9a-fA-F]+$/i.test(raw))) {
            throw new Error("Incorrect format. Requires hex encoded data.");
        }

        let signature = ""

        try {
            signature = await window.SignBytes(this.host, raw, this.dkgResult, this.metadata, this.authData);
        } catch (error) {
            console.error("SignBytes - error:", error)
            throw error;
        }

        return "0x"+signature;
    }

    // Export exports the private key based on client and server shares
    async Export() {

        let privateKey = ""

        try {
            privateKey = await window.Export(this.host, this.dkgResult, this.metadata, this.authData);
        } catch (error) {
            console.error("Export - error:", error)
            throw error;
        }

        return "0x"+privateKey;
    }

    // AcceptDevice runs the TSS process of adding another device
    async AcceptDevice() {
        try {
            await window.AcceptDevice(this.host, this.dkgResult, this.metadata, this.authData);
        } catch (error) {
            console.error("AcceptDevice - error:", error)
            throw error;
        }
    }

    // Backup runs the TSS process of adding a backup to the TSS wallet
    async Backup() {
        try {
            return await window.Backup(this.host, this.dkgResult, this.metadata, this.authData);
        } catch (error) {
            console.error("Backup - error:", error)
            throw error;
        }
    }
}

export default class Meemaw {

    constructor(serverUrl, wasmModule, go) {
        this.host = serverUrl;
        this.wasmModule = wasmModule;
        this.go = go;
    }

    static async init(serverUrl, wasmUrl = '') {
        if (wasmUrl === '') {
            var myWasmUrl = new URL("/meemaw.wasm", serverUrl);
            wasmUrl = myWasmUrl.toString()
        }

        const go = new Go();
        const wasmModule = await WebAssembly.instantiateStreaming(fetch(wasmUrl), go.importObject);
        go.run(wasmModule.instance);
        // console.log("wasm loaded");
        return new Meemaw(serverUrl, wasmModule, go);
    }

    // GetWallet returns the wallet if it exists or creates a new one
    async GetWallet(authData, callbackRegisterStarted, callbackRegisterDone) {
        if (!authData) {
            throw new Error('authData is empty');
        }

        // Get userId
        let userId;
        try {
            userId = await window.Identify(this.host, authData)
        } catch (error) {
            console.error("GetWallet - error getting userId:", error)
            throw error;
        }

        // Check if wallet already exists
        const storedDkgResult = window.localStorage.getItem(localStorageKeys.dkgResult+"-"+userId);
        const storedAddress = window.localStorage.getItem(localStorageKeys.address+"-"+userId);
        const storedMetadata = window.localStorage.getItem(localStorageKeys.metadata+"-"+userId);

        // If it does, return the wallet
        if (storedDkgResult !== null && storedAddress !== null) {
            console.log("GetWallet - loading existing wallet")
            return new Wallet(this.host, storedDkgResult, storedMetadata, storedAddress, authData);
        }

        // Try DKG
        try {
            console.log("GetWallet - starting Dkg")
            const resp = await window.Dkg(this.host, authData);
            // console.log("got DKG resp:", resp)
            const parsedResp = JSON.parse(resp);
            const newDkgResult = JSON.stringify(parsedResp.dkgResult);

            this.storeDkgResults(userId, newDkgResult, parsedResp.dkgResult.Address, parsedResp.metadata);
            return new Wallet(this.host, newDkgResult, parsedResp.metadata, parsedResp.dkgResult.Address, authData);
        } catch (err) {
            // console.error("GetWallet - error while DKG:", err)
            if (err instanceof Error) {    
                // Check for specific error messages or properties
                if (err.message === "conflict") {
                    console.log("GetWallet - wallet already exists on server side. Registering device.");
                } else {
                    console.error("GetWallet - error while dkg:", err.message);
                    throw err;
                }
            } else {
                console.error("GetWallet - unknown error while dkg:", err);
                throw err;
            }
        }

        // If conflict error (= wallet already exists on server side), try RegisterDevice
        try{
            if (typeof callbackRegisterStarted === 'function') {
                callbackRegisterStarted("deviceCode");
            } else {
                console.warn('register device started, but no callback function provided')
            }

            const resp = await window.RegisterDevice(this.host, authData);
            const parsedResp = JSON.parse(resp);
            const newDkgResult = JSON.stringify(parsedResp.dkgResult);
            this.storeDkgResults(userId, newDkgResult, parsedResp.dkgResult.Address, parsedResp.metadata);

            if (typeof callbackRegisterDone === 'function') {
                callbackRegisterDone("deviceCode");
            } else {
                console.warn('register device is done, but no callback function provided')
            }

            return new Wallet(this.host, newDkgResult, parsedResp.metadata, parsedResp.dkgResult.Address, authData);
        } catch(error) {
            console.error("GetWallet - error while registering device:", error)
            throw error;
        }
    }

    // GetWallet returns the wallet if it exists or creates a new one
    async GetWalletFromBackup(authData, backup) {
        if (!authData) {
            throw new Error('authData is empty');
        }

        // Get userId
        let userId;
        try {
            userId = await window.Identify(this.host, authData)
        } catch (error) {
            console.error("GetWalletFromBackup - error getting userId:", error)
            throw error;
        }

        try {
            const resp = await window.FromBackup(this.host, backup, authData);
            const parsedResp = JSON.parse(resp);
            const newDkgResult = JSON.stringify(parsedResp.dkgResult);

            this.storeDkgResults(userId, newDkgResult, parsedResp.dkgResult.Address, parsedResp.metadata);

            return new Wallet(this.host, newDkgResult, parsedResp.metadata, parsedResp.dkgResult.Address, authData);
        } catch(error) {
            console.error("GetWalletFromBackup - error while getting wallet from backup:", error)
            throw error;
        }
    }

    storeDkgResults(userId, dkgResult, address, metadata) {
        window.localStorage.setItem(localStorageKeys.dkgResult+"-"+userId, dkgResult);
        window.localStorage.setItem(localStorageKeys.address+"-"+userId, address);
        window.localStorage.setItem(localStorageKeys.metadata+"-"+userId, metadata);
    }
}