const Web3 = require('web3')
const contracts = require('eth-contract-metadata')
const { warn } = require('loglevel')
const ObservableStore = require('obs-store')
const { MAINNET } = require('../utils/enums')
// By default, poll every 3 minutes
const DEFAULT_INTERVAL = 180 * 1000
const ERC20_ABI = [
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    payable: false,
    type: 'function'
  }
]
const SINGLE_CALL_BALANCES_ABI = require('single-call-balance-checker-abi')
const SINGLE_CALL_BALANCES_ADDRESS = '0xb1f8e55c7f64d203c1400b9d8555d050f94adf39'
/**
 * A controller that polls for token exchange
 * rates based on a user's current token list
 */
class DetectTokensController {
  /**
   * Creates a DetectTokensController
   *
   * @param {Object} [config] - Options to configure controller
   */
  constructor({ interval = DEFAULT_INTERVAL, network } = {}) {
    this.interval = interval
    this.network = network
    this.detectedTokensStore = new ObservableStore({ tokens: [] })
  }

  /**
   * For each token in eth-contract-metada, find check selectedAddress balance.
   *
   */
  async detectNewTokens() {
    if (this._network.store.getState().provider.type !== MAINNET) {
      return
    }
    const tokensToDetect = []
    this.web3.setProvider(this._network._provider)
    for (const contractAddress in contracts) {
      if (contracts[contractAddress].erc20) {
        tokensToDetect.push(contractAddress)
      }
    }
    const web3Instance = this.web3
    const ethContract = new web3Instance.eth.Contract(SINGLE_CALL_BALANCES_ABI, SINGLE_CALL_BALANCES_ADDRESS)
    ethContract.methods.balances([this.selectedAddress], tokensToDetect).call({ from: this.selectedAddress }, (error, result) => {
      if (error) {
        warn('MetaMask - DetectTokensController single call balance fetch failed', error)
        return
      }
      const nonZeroTokens = []
      tokensToDetect.forEach((tokenAddress, index) => {
        const balance = result[index]
        if (!balance.isZero()) {
          // do sth else here
          nonZeroTokens.push({ tokenAddress, balance, ...contracts[tokenAddress] })
          // this._preferences.addToken(tokenAddress, contracts[tokenAddress].symbol, contracts[tokenAddress].decimals)
        }
      })
      this.detectedTokensStore.putState({ tokens: nonZeroTokens })
    })
  }

  /**
   * Find if selectedAddress has tokens with contract in contractAddress.
   *
   * @param {string} contractAddress Hex address of the token contract to explore.
   * @returns {boolean} If balance is detected, token is added.
   *
   */
  async detectTokenBalance(contractAddress) {
    const web3Instance = this.web3
    const ethContract = new web3Instance.eth.Contract(ERC20_ABI, contractAddress)
    ethContract.methods.balanceOf(this.selectedAddress).call({ from: this.selectedAddress }, (error, result) => {
      if (!error) {
        const nonZeroTokens = this.detectedTokensStore.getState().tokens
        if (!result.isZero()) {
          // do sth else here
          const index = nonZeroTokens.findIndex(elem => elem.tokenAddress.toLowerCase() === contractAddress.toLowerCase())
          if (index === -1) {
            nonZeroTokens.push({ tokenAddress: contractAddress, balance: result, ...contracts[contractAddress] })
          } else {
            nonZeroTokens[index] = { ...nonZeroTokens[index], balance: result }
          }
          this.detectedTokensStore.putState({ tokens: nonZeroTokens })
          // this._preferences.addToken(contractAddress, contracts[contractAddress].symbol, contracts[contractAddress].decimals)
        }
      } else {
        warn(`MetaMask - DetectTokensController balance fetch failed for ${contractAddress}.`, error)
      }
    })
  }

  /**
   * Restart token detection polling period and call detectNewTokens
   * in case of address change or user session initialization.
   *
   */
  restartTokenDetection() {
    if (!this.selectedAddress) {
      return
    }
    this.detectNewTokens()
    this.interval = DEFAULT_INTERVAL
  }

  /**
   * @type {Number}
   */
  set interval(interval) {
    this._handle && clearInterval(this._handle)
    if (!interval) {
      return
    }
    this._handle = setInterval(() => {
      this.detectNewTokens()
    }, interval)
  }

  /**
   * @type {Object}
   */
  set network(network) {
    if (!network) {
      return
    }
    this._network = network
    this.web3 = new Web3(network._provider)
  }

  /**
   * In setter when isUnlocked is updated to true, detectNewTokens and restart polling
   * @type {Object}
   */
  startTokenDetection(selectedAddress) {
    this.selectedAddress = selectedAddress
    this.restartTokenDetection()
  }
}

export default DetectTokensController
