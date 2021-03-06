"use strict"

let Contract = require("contract/Contract.js");
let ethRawTrans = require("trans/EthRawTrans.js");
let wanRawTrans = require("trans/WanRawTrans.js");
const ModelOps = require('db/modelOps');
const config = require('conf/config.js');


module.exports = class Erc20CrossAgent {
  constructor(crossToken, crossDirection, action = null, record = null, logger = null) {
  	this.logger = logger;
    let token = config.crossTokenDict[crossToken];
    this.tokenAddr = token.tokenAddr;
    this.tokenSymbol = token.tokenSymbol;
    this.crossDirection = crossDirection; /* 0 -- token to Wtoken, 1 -- Wtoken to token */
    let crossInfoInst = config.crossInfoDict[config.crossTypeDict[token.tokenType]];
    this.transChainType = this.getTransChainType(crossDirection, action); /* wan -- trans on wanchain HTLC contract, or, trans on originchain HTLC contract */

    let abi = (this.transChainType !== 'wan') ? crossInfoInst.originalChainHtlcAbi : crossInfoInst.wanchainHtlcAbi;
    this.contractAddr = (this.transChainType !== 'wan') ? crossInfoInst.originalChainHtlcAddr : crossInfoInst.wanchainHtlcAddr;
    let erc20Abi = config.erc20Abi;

    this.contract = new Contract(abi, this.contractAddr);
    this.tokenContract = new Contract(erc20Abi, this.tokenAddr);

    this.crossFunc = (this.crossDirection === 0) ? crossInfoInst.depositFunc : crossInfoInst.withdrawFunc;
    this.crossEvent = (this.crossDirection === 0) ? crossInfoInst.depositEvent : crossInfoInst.withdrawEvent;
    this.approveFunc = 'approve';

    if (record !== null) {
      if (record.hasOwnProperty('x')) {
        this.key = record.x;
      }

      this.hashKey = record.hashX;
      this.amount = record.value;
      this.crossAddress = record.crossAddress;
    }

    if (action !== null) {
      let transInfo = this.getTransInfo(action);
      if (this.transChainType === 'wan') {
        this.trans = new wanRawTrans(...transInfo);
        this.chain = global.wanChain;
      } else {
        this.trans = new ethRawTrans(...transInfo);
        this.chain = global.ethChain;
      }      
    }

    this.lockEvent = this.contract.getEventSignature(this.crossEvent[0]);
    this.refundEvent = this.contract.getEventSignature(this.crossEvent[1]);
    this.revokeEvent = this.contract.getEventSignature(this.crossEvent[2]);

    this.depositLockEvent = this.contract.getEventSignature(crossInfoInst.depositEvent[0]);
    this.depositRefundEvent = this.contract.getEventSignature(crossInfoInst.depositEvent[1]);
    this.depositRevokeEvent = this.contract.getEventSignature(crossInfoInst.depositEvent[2]);
    this.withdrawLockEvent = this.contract.getEventSignature(crossInfoInst.withdrawEvent[0]);
    this.withdrawRefundEvent = this.contract.getEventSignature(crossInfoInst.withdrawEvent[1]);
    this.withdrawRevokeEvent = this.contract.getEventSignature(crossInfoInst.withdrawEvent[2]);

    // console.log("this.lockEvent", this.lockEvent);
    // console.log("this.refundEvent", this.refundEvent);
    // console.log("this.revokeEvent", this.revokeEvent);
    // console.log("this.contractAddr", this.contractAddr);
    // console.log("this.depositLockEvent", this.depositLockEvent);
    // console.log("this.depositRefundEvent", this.depositRefundEvent);
    // console.log("this.depositRevokeEvent", this.depositRevokeEvent);
    // console.log("this.withdrawLockEvent", this.withdrawLockEvent);
    // console.log("this.withdrawRefundEvent", this.withdrawRefundEvent);
    // console.log("this.withdrawRevokeEvent", this.withdrawRevokeEvent);
  }

  setKey(key) {
    this.key = key;
  }
  setHashKey(hashKey) {
    this.hashKey = hashKey;
  }

  getTransChainType(crossDirection, action) {

    if (this.crossDirection === 0) {
      if (action === 'refund') {
        return 'eth';
      } else {
        return 'wan';
      }
    } else {
      if (action === 'refund') {
        return 'wan';
      } else {
        return 'eth';
      }
    }
  }

  getWeiFromEther(ether) {
    return ether * 1000 * 1000 * 1000 * 1000 * 1000 * 1000;
  }

  getWeiFromGwei(ether) {
    return ether * 1000 * 1000 * 1000;
  }

  getNonce() {
    if (this.transChainType === 'wan') {
      if (global.lastWanNonce === 0) {
        global.lastWanNonce = parseInt(global.wanNonce, 16);
      } else {
        global.lastWanNonce++;
      }
      return global.lastWanNonce;
    } else {
      if (global.lastEthNonce === 0) {
        global.lastEthNonce = parseInt(global.ethNonce, 16);
      } else {
        global.lastEthNonce++;
      }
      return global.lastEthNonce;
    }
  }

  getTransInfo(action) {
    let from;
    let to;
    let amount;
    let gas;
    let gasPrice;
    let nonce;

    if (action === 'approve') {
      from = global.storemanEth;
    } else if (action === 'refund') {
      from = (this.crossDirection === 0) ? global.storemanEth : global.storemanWan;
    } else {
      from = (this.crossDirection === 0) ? global.storemanWan : global.storemanEth;
    }

    to = (action === 'approve') ? this.tokenAddr : this.contractAddr;
    amount = this.amount;

    if (this.transChainType === 'wan') {
      gas = global.wanGasLimit;
      gasPrice = this.getWeiFromGwei(global.wanGasPrice);
    } else {
      gas = global.ethGasLimit;
      gasPrice = global.ethGasPrice;
    }

    nonce = this.getNonce();
    this.logger.info("transInfo is: crossDirection- %s, transChainType- %s,\n from- %s, to- %s, gas- %s, gasPrice- %s, nonce- %s, amount- %s, \n hashX- %s", this.crossDirection, this.transChainType, from, to, gas, gasPrice, nonce, amount, this.hashKey);
    return [from, to, gas, gasPrice, nonce, amount];
  }

  getApproveData() {
    console.log("********************************** funcInterface **********************************", this.approveFunc);
    return this.tokenContract.constructData(this.approveFunc, this.contractAddr, this.amount);
  }

  getLockData() {
    console.log("********************************** funcInterface **********************************", this.crossFunc[0], "hashX", this.hashKey);
    this.logger.debug('getLockData: transChainType-', this.transChainType, 'crossDirection-', this.crossDirection, 'tokenAddr-', this.tokenAddr, 'hashKey-', this.hashKey,'crossAddress-', this.crossAddress,'Amount-', this.amount);
    return this.contract.constructData(this.crossFunc[0], this.tokenAddr, this.hashKey, this.crossAddress, this.amount);
  }
  getRefundData() {
    console.log("********************************** funcInterface **********************************", this.crossFunc[1], "hashX", this.hashKey);
    this.logger.debug('getRefundData: transChainType-', this.transChainType, 'crossDirection-', this.crossDirection, 'tokenAddr-', this.tokenAddr, 'hashKey-', this.hashKey, 'key-', this.key);
    return this.contract.constructData(this.crossFunc[1], this.tokenAddr, this.key);
  }
  getRevokeData() {
    console.log("********************************** funcInterface **********************************", this.crossFunc[2], "hashX", this.hashKey);
    this.logger.debug('getRevokeData: transChainType-', this.transChainType, 'crossDirection-', this.crossDirection, 'tokenAddr-', this.tokenAddr, 'hashKey-', this.hashKey);
    return this.contract.constructData(this.crossFunc[2], this.tokenAddr, this.hashKey);
  }

  getLockEventTopic() {
    return [this.lockEvent, null, null, this.hashKey];
  }

  getRefundEventTopic() {
    return [this.refundEvent, null, null, this.hashKey];
  }

  getRevokeEventTopic() {
    return [this.revokeEvent, null, this.hashKey];
  }

  async createTrans(action) {
    let self = this;
    let data;
    let build;

    return new Promise((resolve, reject) => {
      if (action === 'approve') {
        data = self.getApproveData();
        build = self.buildApproveData;
      } else if (action === 'lock') {
        data = self.getLockData();
        build = self.buildLockData;
      } else if (action === 'refund') {
        data = self.getRefundData();
        build = self.buildRefundData;
      } else if (action === 'revoke') {
        data = self.getRevokeData();
        build = self.buildRevokeData;
      }

      self.sendTrans(global.password, data, build, (err, result) => {
        if (!err && result !== null) {
          resolve(result);
        } else {
          reject(err);
        }
      })

    })
  }

  sendTrans(password, data, build, callback) {
    console.log("********************************** sendTransaction ********************************** hashX", this.hashKey);
    console.log("********************************** setData **********************************", data, "hashX", this.hashKey);
    this.trans.setData(data);
    this.trans.setValue(0);

    let rawTx = this.trans.signFromKeystore(password);
    let self = this;
    this.chain.sendRawTransaction(rawTx, (err, result) => {
      if (!err) {
        self.logger.debug("sendRawTransaction result: ", result);
        console.log("********************************** sendTransaction success ********************************** hashX", self.hashKey);
        let content = build(self.hashKey, result);
        callback(err, content);
      } else {
        console.log("********************************** sendTransaction failed ********************************** hashX", self.hashKey);
        callback(err, result);
      }
    });
  }

  buildApproveData(hashKey, result) {
    console.log("********************************** insertApproveData trans **********************************", hashKey);

    let content = {
      // status: 'waitingCrossApproveConfirming',
      storemanApproveTxHash: result.toLowerCase()
    }
    // this.logger.debug("insertApproveData storemanApproveTxHash: ", result);
    // this.modelOps.saveScannedEvent(this.hashKey, content);
    return content;
  }

  buildLockData(hashKey, result) {
    console.log("********************************** insertLockData trans **********************************", hashKey);

    let content = {
      // status: 'waitingCrossLockConfirming',
      storemanLockTxHash: result.toLowerCase()
    }
    // this.logger.debug("insertLockData storemanLockTxHash: ", result);
    // this.modelOps.saveScannedEvent(this.hashKey, content);
    return content;
  }

  buildRefundData(hashKey, result) {
    console.log("********************************** insertRefundData trans **********************************", hashKey);

    let content = {
      // status: 'waitingCrossRefundConfirming',
      storemanRefundTxHash: result.toLowerCase()
    }
    // this.logger.debug("insertRefundData storemanRefundTxHash: ", result);
    // this.modelOps.saveScannedEvent(this.hashKey, content);
    return content;
  }

  buildRevokeData(hashKey, result) {
    console.log("********************************** insertRevokeData trans **********************************", hashKey);

    let content = {
      // status: 'waitingCrossRevokeConfirming',
      storemanRevokeTxHash: result.toLowerCase()
    }
    // this.logger.debug("insertRevokeData storemanRevokeTxHash: ", result);
    // this.modelOps.saveScannedEvent(this.hashKey, content);
    return content;
  }
}