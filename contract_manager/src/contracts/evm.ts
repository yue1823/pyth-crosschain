import Web3 from "web3";
import type { Contract } from "web3-eth-contract";
import { PriceFeedContract, PrivateKey, Storable } from "../base";
import { Chain, EvmChain } from "../chains";
import { DataSource } from "@pythnetwork/xc-admin-common";
import { WormholeContract } from "./wormhole";
import { TokenQty } from "../token";
import {
  EXECUTOR_ABI,
  EXPRESS_RELAY_ABI,
  EXTENDED_ENTROPY_ABI,
  EXTENDED_PYTH_ABI,
  WORMHOLE_ABI,
  PULSE_UPGRADEABLE_ABI,
} from "./evm_abis";

/**
 * Returns the keccak256 digest of the contract bytecode at the given address after replacing
 * any occurrences of the contract addr in the bytecode with 0.The bytecode stores the deployment
 * address as an immutable variable. This behavior is inherited from OpenZeppelin's implementation
 * of UUPSUpgradeable contract. You can read more about verification with immutable variables here:
 * https://docs.sourcify.dev/docs/immutables/
 * This function can be used to verify that the contract code is the same on all chains and matches
 * with the deployedCode property generated by truffle builds
 */
export async function getCodeDigestWithoutAddress(
  web3: Web3,
  address: string,
): Promise<string> {
  const code = await web3.eth.getCode(address);
  const strippedCode = code.replaceAll(
    address.toLowerCase().replace("0x", ""),
    "0000000000000000000000000000000000000000",
  );
  return Web3.utils.keccak256(strippedCode);
}

export class EvmWormholeContract extends WormholeContract {
  static type = "EvmWormholeContract";

  getId(): string {
    return `${this.chain.getId()}_${this.address}`;
  }

  getChain(): EvmChain {
    return this.chain;
  }

  getType(): string {
    return EvmWormholeContract.type;
  }

  async getVersion(): Promise<string> {
    const contract = this.getContract();
    return contract.methods.version().call();
  }

  static fromJson(
    chain: Chain,
    parsed: { type: string; address: string },
  ): EvmWormholeContract {
    if (parsed.type !== EvmWormholeContract.type)
      throw new Error("Invalid type");
    if (!(chain instanceof EvmChain))
      throw new Error(`Wrong chain type ${chain}`);
    return new EvmWormholeContract(chain, parsed.address);
  }

  constructor(
    public chain: EvmChain,
    public address: string,
  ) {
    super();
  }
  getContract(): Contract {
    const web3 = this.chain.getWeb3();
    return new web3.eth.Contract(WORMHOLE_ABI, this.address);
  }

  async getCurrentGuardianSetIndex(): Promise<number> {
    const wormholeContract = this.getContract();
    return Number(
      await wormholeContract.methods.getCurrentGuardianSetIndex().call(),
    );
  }

  async getChainId(): Promise<number> {
    const wormholeContract = this.getContract();
    return Number(await wormholeContract.methods.chainId().call());
  }

  /**
   * Returns an array of guardian addresses used for VAA verification in this contract
   */
  async getGuardianSet(): Promise<string[]> {
    const wormholeContract = this.getContract();
    const currentIndex = await this.getCurrentGuardianSetIndex();
    const [currentSet] = await wormholeContract.methods
      .getGuardianSet(currentIndex)
      .call();
    return currentSet;
  }

  async upgradeGuardianSets(senderPrivateKey: PrivateKey, vaa: Buffer) {
    const web3 = this.chain.getWeb3();
    const { address } = web3.eth.accounts.wallet.add(senderPrivateKey);
    const wormholeContract = new web3.eth.Contract(WORMHOLE_ABI, this.address);
    const transactionObject = wormholeContract.methods.submitNewGuardianSet(
      "0x" + vaa.toString("hex"),
    );
    const result = await this.chain.estiamteAndSendTransaction(
      transactionObject,
      { from: address },
    );
    return { id: result.transactionHash, info: result };
  }

  toJson() {
    return {
      chain: this.chain.getId(),
      address: this.address,
      type: EvmWormholeContract.type,
    };
  }
}

interface EntropyProviderInfo {
  feeInWei: string;
  accruedFeesInWei: string;
  originalCommitment: string;
  originalCommitmentSequenceNumber: string;
  commitmentMetadata: string;
  uri: string;
  endSequenceNumber: string;
  sequenceNumber: string;
  currentCommitment: string;
  currentCommitmentSequenceNumber: string;
  feeManager: string;
}

interface EntropyRequest {
  provider: string;
  sequenceNumber: string;
  numHashes: string;
  commitment: string;
  blockNumber: string;
  requester: string;
  useBlockhash: boolean;
  isRequestWithCallback: boolean;
}

export const ENTROPY_DEFAULT_PROVIDER = {
  mainnet: "0x52DeaA1c84233F7bb8C8A45baeDE41091c616506",
  testnet: "0x6CC14824Ea2918f5De5C2f75A9Da968ad4BD6344",
};
export const ENTROPY_DEFAULT_KEEPER = {
  mainnet: "0xbcab779fca45290288c35f5e231c37f9fa87b130",
  testnet: "0xa5A68ed167431Afe739846A22597786ba2da85df",
};

export class EvmEntropyContract extends Storable {
  static type = "EvmEntropyContract";

  constructor(
    public chain: EvmChain,
    public address: string,
  ) {
    super();
  }

  getId(): string {
    return `${this.chain.getId()}_${this.address}`;
  }

  getChain(): EvmChain {
    return this.chain;
  }

  getType(): string {
    return EvmEntropyContract.type;
  }

  async getVersion(): Promise<string> {
    const contract = this.getContract();
    return contract.methods.version().call();
  }

  static fromJson(
    chain: Chain,
    parsed: { type: string; address: string },
  ): EvmEntropyContract {
    if (parsed.type !== EvmEntropyContract.type)
      throw new Error("Invalid type");
    if (!(chain instanceof EvmChain))
      throw new Error(`Wrong chain type ${chain}`);
    return new EvmEntropyContract(chain, parsed.address);
  }

  // Generates a payload for the newAdmin to call acceptAdmin on the entropy contracts
  generateAcceptAdminPayload(newAdmin: string): Buffer {
    const contract = this.getContract();
    const data = contract.methods.acceptAdmin().encodeABI();
    return this.chain.generateExecutorPayload(newAdmin, this.address, data);
  }

  // Generates a payload for newOwner to call acceptOwnership on the entropy contracts
  generateAcceptOwnershipPayload(newOwner: string): Buffer {
    const contract = this.getContract();
    const data = contract.methods.acceptOwnership().encodeABI();
    return this.chain.generateExecutorPayload(newOwner, this.address, data);
  }

  async generateUpgradeEntropyContractPayload(
    newImplementation: string,
  ): Promise<Buffer> {
    const contract = this.getContract();
    const data = contract.methods.upgradeTo(newImplementation).encodeABI();
    return this.chain.generateExecutorPayload(
      await this.getOwner(),
      this.address,
      data,
    );
  }

  // Generates a payload to upgrade the executor contract, the owner of entropy contracts
  async generateUpgradeExecutorContractsPayload(
    newImplementation: string,
  ): Promise<Buffer> {
    // Executor contract is the owner of entropy contract
    const executorAddr = await this.getOwner();
    const web3 = this.chain.getWeb3();
    const executor = new web3.eth.Contract(EXECUTOR_ABI, executorAddr);
    const data = executor.methods.upgradeTo(newImplementation).encodeABI();
    return this.chain.generateExecutorPayload(executorAddr, executorAddr, data);
  }

  async getOwner(): Promise<string> {
    const contract = this.getContract();
    return contract.methods.owner().call();
  }

  async getExecutorContract(): Promise<EvmExecutorContract> {
    const owner = await this.getOwner();
    return new EvmExecutorContract(this.chain, owner);
  }

  async getPendingOwner(): Promise<string> {
    const contract = this.getContract();
    return contract.methods.pendingOwner().call();
  }

  toJson() {
    return {
      chain: this.chain.getId(),
      address: this.address,
      type: EvmEntropyContract.type,
    };
  }

  getContract() {
    const web3 = this.chain.getWeb3();
    return new web3.eth.Contract(EXTENDED_ENTROPY_ABI, this.address);
  }

  async getDefaultProvider(): Promise<string> {
    const contract = this.getContract();
    return await contract.methods.getDefaultProvider().call();
  }

  async getProviderInfo(address: string): Promise<EntropyProviderInfo> {
    const contract = this.getContract();
    const info: EntropyProviderInfo = await contract.methods
      .getProviderInfo(address)
      .call();
    return {
      ...info,
      uri: Web3.utils.toAscii(info.uri),
    };
  }

  /**
   * Returns the request for the given provider and sequence number
   * This will return a EntropyRequest object with sequenceNumber "0" if the request does not exist
   * @param provider The entropy provider address
   * @param sequenceNumber The sequence number of the request for the provider
   */
  async getRequest(
    provider: string,
    sequenceNumber: number,
  ): Promise<EntropyRequest> {
    const contract = this.getContract();
    return contract.methods.getRequest(provider, sequenceNumber).call();
  }

  /**
   * Returns the user random number for the request with the given provider and sequence number
   * This method assumes the request was made with a callback option and fetches the user random number
   * by finding the `RequestedWithCallback` log. The block number at which the request was made is required
   * to find the log.
   * @param provider The entropy provider address
   * @param sequenceNumber The sequence number of the request for the provider
   * @param block The block number at which the request was made, you can find this using the `getRequest` method
   */
  async getUserRandomNumber(
    provider: string,
    sequenceNumber: number,
    block: number,
  ): Promise<string> {
    const contract = this.getContract();
    const result = await contract.getPastEvents("RequestedWithCallback", {
      fromBlock: block,
      toBlock: block,
      filter: {
        provider,
        sequenceNumber: sequenceNumber,
      },
    });
    return result[0].returnValues.userRandomNumber;
  }

  /**
   * Submits a transaction to the entropy contract to reveal the random number and call the callback function
   * @param userRandomNumber The random number generated by the user, you can find this using the `getUserRandomNumber` method
   * @param providerRevelation The random number generated by the provider, you can find this via the provider server
   * @param provider The entropy provider address
   * @param sequenceNumber The sequence number of the request for the provider
   * @param senderPrivateKey The private key to use for submitting the transaction on-chain
   */
  async revealWithCallback(
    userRandomNumber: string,
    providerRevelation: string,
    provider: string,
    sequenceNumber: number,
    senderPrivateKey: PrivateKey,
  ) {
    const web3 = this.chain.getWeb3();
    // can not use `this.getContract()` because it uses another web3 instance without the wallet
    const contract = new web3.eth.Contract(EXTENDED_ENTROPY_ABI, this.address);
    const { address } = web3.eth.accounts.wallet.add(senderPrivateKey);
    const transactionObject = contract.methods.revealWithCallback(
      provider,
      sequenceNumber,
      userRandomNumber,
      providerRevelation,
    );
    return this.chain.estiamteAndSendTransaction(transactionObject, {
      from: address,
    });
  }

  generateUserRandomNumber() {
    const web3 = this.chain.getWeb3();
    return web3.utils.randomHex(32);
  }

  async getFee(provider: string): Promise<number> {
    const contract = this.getContract();
    return await contract.methods.getFee(provider).call();
  }

  async requestRandomness(
    userRandomNumber: string,
    provider: string,
    senderPrivateKey: PrivateKey,
    withCallback?: boolean,
  ) {
    const web3 = this.chain.getWeb3();
    const userCommitment = web3.utils.keccak256(userRandomNumber);
    const contract = new web3.eth.Contract(EXTENDED_ENTROPY_ABI, this.address);
    const fee = await contract.methods.getFee(provider).call();
    const { address } = web3.eth.accounts.wallet.add(senderPrivateKey);

    let transactionObject;
    if (withCallback) {
      transactionObject = contract.methods.requestWithCallback(
        provider,
        userCommitment,
      );
    } else {
      const useBlockHash = false;
      transactionObject = contract.methods.request(
        provider,
        userCommitment,
        useBlockHash,
      );
    }

    return this.chain.estiamteAndSendTransaction(transactionObject, {
      from: address,
      value: fee,
    });
  }

  async revealRandomness(
    userRevelation: string,
    providerRevelation: string,
    provider: string,
    sequenceNumber: string,
    senderPrivateKey: PrivateKey,
  ) {
    const web3 = this.chain.getWeb3();
    const contract = new web3.eth.Contract(EXTENDED_ENTROPY_ABI, this.address);
    const { address } = web3.eth.accounts.wallet.add(senderPrivateKey);
    const transactionObject = contract.methods.reveal(
      provider,
      sequenceNumber,
      userRevelation,
      providerRevelation,
    );
    return this.chain.estiamteAndSendTransaction(transactionObject, {
      from: address,
    });
  }
}

export class EvmExpressRelayContract extends Storable {
  static type = "EvmExpressRelayContract";

  constructor(
    public chain: EvmChain,
    public address: string,
  ) {
    super();
  }

  getId(): string {
    return `${this.chain.getId()}_${this.address}`;
  }

  getChain(): EvmChain {
    return this.chain;
  }

  getType(): string {
    return EvmExpressRelayContract.type;
  }

  async getVersion(): Promise<string> {
    const contract = this.getContract();
    return contract.methods.version().call();
  }

  static fromJson(
    chain: Chain,
    parsed: { type: string; address: string },
  ): EvmExpressRelayContract {
    if (parsed.type !== EvmExpressRelayContract.type)
      throw new Error("Invalid type");
    if (!(chain instanceof EvmChain))
      throw new Error(`Wrong chain type ${chain}`);
    return new EvmExpressRelayContract(chain, parsed.address);
  }

  async generateSetRelayerPayload(relayer: string): Promise<Buffer> {
    const contract = this.getContract();
    const data = contract.methods.setRelayer(relayer).encodeABI();
    return this.chain.generateExecutorPayload(
      await this.getOwner(),
      this.address,
      data,
    );
  }

  async getOwner(): Promise<string> {
    const contract = this.getContract();
    return contract.methods.owner().call();
  }

  async getExecutorContract(): Promise<EvmExecutorContract> {
    const owner = await this.getOwner();
    return new EvmExecutorContract(this.chain, owner);
  }

  async getPendingOwner(): Promise<string> {
    const contract = this.getContract();
    return contract.methods.pendingOwner().call();
  }

  async getRelayer(): Promise<string> {
    const contract = this.getContract();
    return contract.methods.getRelayer().call();
  }

  async getRelayerSubwallets(): Promise<string[]> {
    const contract = this.getContract();
    return contract.methods.getRelayerSubwallets().call();
  }

  toJson() {
    return {
      chain: this.chain.getId(),
      address: this.address,
      type: EvmExpressRelayContract.type,
    };
  }

  getContract() {
    const web3 = this.chain.getWeb3();
    return new web3.eth.Contract(EXPRESS_RELAY_ABI, this.address);
  }
}

export class EvmExecutorContract {
  constructor(
    public chain: EvmChain,
    public address: string,
  ) {}

  getId(): string {
    return `${this.chain.getId()}_${this.address}`;
  }

  async getWormholeContract(): Promise<EvmWormholeContract> {
    const web3 = this.chain.getWeb3();
    //Unfortunately, there is no public method to get the wormhole address
    //Found 251 by using `forge build --extra-output storageLayout` and finding the slot for the wormhole variable.
    let address = await web3.eth.getStorageAt(this.address, 251);
    address = "0x" + address.slice(26);
    return new EvmWormholeContract(this.chain, address);
  }

  getContract() {
    const web3 = this.chain.getWeb3();
    return new web3.eth.Contract(EXECUTOR_ABI, this.address);
  }

  async getLastExecutedGovernanceSequence() {
    return await this.getContract().methods.getLastExecutedSequence().call();
  }

  async getGovernanceDataSource(): Promise<DataSource> {
    const executorContract = this.getContract();
    const ownerEmitterAddress = await executorContract.methods
      .getOwnerEmitterAddress()
      .call();
    const ownerEmitterChainid = await executorContract.methods
      .getOwnerChainId()
      .call();
    return {
      emitterChain: Number(ownerEmitterChainid),
      emitterAddress: ownerEmitterAddress.replace("0x", ""),
    };
  }

  /**
   * Returns the owner of the executor contract, this should always be the contract address itself
   */
  async getOwner(): Promise<string> {
    const contract = this.getContract();
    return contract.methods.owner().call();
  }

  async executeGovernanceInstruction(
    senderPrivateKey: PrivateKey,
    vaa: Buffer,
  ) {
    const web3 = this.chain.getWeb3();
    const { address } = web3.eth.accounts.wallet.add(senderPrivateKey);
    const executorContract = new web3.eth.Contract(EXECUTOR_ABI, this.address);
    const transactionObject = executorContract.methods.execute(
      "0x" + vaa.toString("hex"),
    );
    const result = await this.chain.estiamteAndSendTransaction(
      transactionObject,
      { from: address },
    );
    return { id: result.transactionHash, info: result };
  }
}

export class EvmPriceFeedContract extends PriceFeedContract {
  static type = "EvmPriceFeedContract";

  constructor(
    public chain: EvmChain,
    public address: string,
  ) {
    super();
  }

  static fromJson(
    chain: Chain,
    parsed: { type: string; address: string },
  ): EvmPriceFeedContract {
    if (parsed.type !== EvmPriceFeedContract.type)
      throw new Error("Invalid type");
    if (!(chain instanceof EvmChain))
      throw new Error(`Wrong chain type ${chain}`);
    return new EvmPriceFeedContract(chain, parsed.address);
  }

  getId(): string {
    return `${this.chain.getId()}_${this.address}`;
  }

  getType(): string {
    return EvmPriceFeedContract.type;
  }

  async getVersion(): Promise<string> {
    const pythContract = this.getContract();
    const result = await pythContract.methods.version().call();
    return result;
  }

  getContract() {
    const web3 = this.chain.getWeb3();
    const pythContract = new web3.eth.Contract(EXTENDED_PYTH_ABI, this.address);
    return pythContract;
  }

  /**
   * Returns the bytecode of the contract in hex format
   */
  async getCode(): Promise<string> {
    // TODO: handle proxy contracts
    const web3 = this.chain.getWeb3();
    return web3.eth.getCode(this.address);
  }

  async getImplementationAddress(): Promise<string> {
    const web3 = this.chain.getWeb3();
    // bytes32(uint256(keccak256('eip1967.proxy.implementation')) - 1) according to EIP-1967
    const storagePosition =
      "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
    let address = await web3.eth.getStorageAt(this.address, storagePosition);
    address = "0x" + address.slice(26);
    return address;
  }

  /**
   * Returns the keccak256 digest of the contract bytecode
   */
  async getCodeDigestWithoutAddress(): Promise<string> {
    return getCodeDigestWithoutAddress(this.chain.getWeb3(), this.address);
  }

  async getTotalFee(): Promise<TokenQty> {
    let web3: Web3;
    let amount = BigInt(0);
    try {
      web3 = this.chain.getViemDefaultWeb3();
      amount = BigInt(await web3.eth.getBalance(this.address));
    } catch (error) {
      // Fallback to regular web3 if viem default web3 fails
      web3 = this.chain.getWeb3();
      amount = BigInt(await web3.eth.getBalance(this.address));
    }
    return {
      amount,
      denom: this.chain.getNativeToken(),
    };
  }

  async getLastExecutedGovernanceSequence() {
    const pythContract = await this.getContract();
    return Number(
      await pythContract.methods.lastExecutedGovernanceSequence().call(),
    );
  }

  async getPriceFeed(feedId: string) {
    const pythContract = this.getContract();
    const feed = "0x" + feedId;
    const exists = await pythContract.methods.priceFeedExists(feed).call();
    if (!exists) {
      return undefined;
    }
    const [price, conf, expo, publishTime] = await pythContract.methods
      .getPriceUnsafe(feed)
      .call();

    const [emaPrice, emaConf, emaExpo, emaPublishTime] =
      await pythContract.methods.getEmaPriceUnsafe(feed).call();
    return {
      price: { price, conf, expo, publishTime },
      emaPrice: {
        price: emaPrice,
        conf: emaConf,
        expo: emaExpo,
        publishTime: emaPublishTime,
      },
    };
  }

  async getValidTimePeriod() {
    const pythContract = this.getContract();
    const result = await pythContract.methods.getValidTimePeriod().call();
    return Number(result);
  }

  /**
   * Returns the wormhole contract which is being used for VAA verification
   */
  async getWormholeContract(): Promise<EvmWormholeContract> {
    const pythContract = this.getContract();
    const address = await pythContract.methods.wormhole().call();
    return new EvmWormholeContract(this.chain, address);
  }

  async getBaseUpdateFee() {
    const pythContract = this.getContract();
    const result = await pythContract.methods.singleUpdateFeeInWei().call();
    return { amount: result };
  }

  async getDataSources(): Promise<DataSource[]> {
    const pythContract = this.getContract();
    const result = await pythContract.methods.validDataSources().call();
    return result.map(
      ({
        chainId,
        emitterAddress,
      }: {
        chainId: string;
        emitterAddress: string;
      }) => {
        return {
          emitterChain: Number(chainId),
          emitterAddress: emitterAddress.replace("0x", ""),
        };
      },
    );
  }

  async getGovernanceDataSource(): Promise<DataSource> {
    const pythContract = this.getContract();
    const [chainId, emitterAddress] = await pythContract.methods
      .governanceDataSource()
      .call();
    return {
      emitterChain: Number(chainId),
      emitterAddress: emitterAddress.replace("0x", ""),
    };
  }

  async executeUpdatePriceFeed(senderPrivateKey: PrivateKey, vaas: Buffer[]) {
    const web3 = this.chain.getWeb3();
    const { address } = web3.eth.accounts.wallet.add(senderPrivateKey);
    const pythContract = new web3.eth.Contract(EXTENDED_PYTH_ABI, this.address);
    const priceFeedUpdateData = vaas.map((vaa) => "0x" + vaa.toString("hex"));
    const updateFee = await pythContract.methods
      .getUpdateFee(priceFeedUpdateData)
      .call();
    const transactionObject =
      pythContract.methods.updatePriceFeeds(priceFeedUpdateData);
    const result = await this.chain.estiamteAndSendTransaction(
      transactionObject,
      { from: address, value: updateFee },
    );
    return { id: result.transactionHash, info: result };
  }

  async executeGovernanceInstruction(
    senderPrivateKey: PrivateKey,
    vaa: Buffer,
  ) {
    const web3 = this.chain.getWeb3();
    const { address } = web3.eth.accounts.wallet.add(senderPrivateKey);
    const pythContract = new web3.eth.Contract(EXTENDED_PYTH_ABI, this.address);
    const transactionObject = pythContract.methods.executeGovernanceInstruction(
      "0x" + vaa.toString("hex"),
    );
    const result = await this.chain.estiamteAndSendTransaction(
      transactionObject,
      { from: address },
    );
    return { id: result.transactionHash, info: result };
  }

  getChain(): EvmChain {
    return this.chain;
  }

  toJson() {
    return {
      chain: this.chain.getId(),
      address: this.address,
      type: EvmPriceFeedContract.type,
    };
  }
}

export const PULSE_DEFAULT_PROVIDER = {
  mainnet: "0x78357316239040e19fC823372cC179ca75e64b81",
  testnet: "0x78357316239040e19fC823372cC179ca75e64b81",
};
export const PULSE_DEFAULT_KEEPER = {
  mainnet: "0x78357316239040e19fC823372cC179ca75e64b81",
  testnet: "0x78357316239040e19fC823372cC179ca75e64b81",
};

export class EvmPulseContract extends Storable {
  static type = "EvmPulseContract";

  constructor(
    public chain: EvmChain,
    public address: string,
  ) {
    super();
  }

  getId(): string {
    return `${this.chain.getId()}_${this.address}`;
  }

  getChain(): EvmChain {
    return this.chain;
  }

  getType(): string {
    return EvmPulseContract.type;
  }

  getContract() {
    const web3 = this.chain.getWeb3();
    return new web3.eth.Contract(PULSE_UPGRADEABLE_ABI, this.address);
  }

  static fromJson(
    chain: Chain,
    parsed: { type: string; address: string },
  ): EvmPulseContract {
    if (parsed.type !== EvmPulseContract.type) throw new Error("Invalid type");
    if (!(chain instanceof EvmChain))
      throw new Error(`Wrong chain type ${chain}`);
    return new EvmPulseContract(chain, parsed.address);
  }

  toJson() {
    return {
      chain: this.chain.getId(),
      address: this.address,
      type: EvmPulseContract.type,
    };
  }

  async getOwner(): Promise<string> {
    const contract = this.getContract();
    return contract.methods.owner().call();
  }

  async getExecutorContract(): Promise<EvmExecutorContract> {
    const owner = await this.getOwner();
    return new EvmExecutorContract(this.chain, owner);
  }

  async getPythFeeInWei(): Promise<string> {
    const contract = this.getContract();
    return contract.methods.getPythFeeInWei().call();
  }

  async getFee(callbackGasLimit: number): Promise<string> {
    const contract = this.getContract();
    return contract.methods.getFee(callbackGasLimit).call();
  }

  async getAccruedFees(): Promise<string> {
    const contract = this.getContract();
    return contract.methods.getAccruedFees().call();
  }

  async getRequest(sequenceNumber: number): Promise<{
    provider: string;
    publishTime: string;
    priceIds: string[];
    callbackGasLimit: string;
    requester: string;
  }> {
    const contract = this.getContract();
    return contract.methods.getRequest(sequenceNumber).call();
  }

  async getDefaultProvider(): Promise<string> {
    const contract = this.getContract();
    return contract.methods.getDefaultProvider().call();
  }

  async getProviderInfo(provider: string): Promise<{
    feeInWei: string;
    accruedFeesInWei: string;
  }> {
    const contract = this.getContract();
    return contract.methods.getProviderInfo(provider).call();
  }

  async getExclusivityPeriod(): Promise<string> {
    const contract = this.getContract();
    return contract.methods.getExclusivityPeriod().call();
  }

  async getFirstActiveRequests(count: number): Promise<{
    requests: Array<{
      provider: string;
      publishTime: string;
      priceIds: string[];
      callbackGasLimit: string;
      requester: string;
    }>;
    actualCount: number;
  }> {
    const contract = this.getContract();
    return contract.methods.getFirstActiveRequests(count).call();
  }

  async requestPriceUpdatesWithCallback(
    senderPrivateKey: PrivateKey,
    publishTime: number,
    priceIds: string[],
    callbackGasLimit: number,
  ) {
    const web3 = this.chain.getWeb3();
    const { address } = web3.eth.accounts.wallet.add(senderPrivateKey);
    const contract = new web3.eth.Contract(PULSE_UPGRADEABLE_ABI, this.address);

    const fee = await this.getFee(callbackGasLimit);
    const transactionObject = contract.methods.requestPriceUpdatesWithCallback(
      publishTime,
      priceIds,
      callbackGasLimit,
    );

    const result = await this.chain.estiamteAndSendTransaction(
      transactionObject,
      { from: address, value: fee },
    );
    return { id: result.transactionHash, info: result };
  }

  async executeCallback(
    senderPrivateKey: PrivateKey,
    sequenceNumber: number,
    updateData: string[],
    priceIds: string[],
  ) {
    const web3 = this.chain.getWeb3();
    const { address } = web3.eth.accounts.wallet.add(senderPrivateKey);
    const contract = new web3.eth.Contract(PULSE_UPGRADEABLE_ABI, this.address);

    const transactionObject = contract.methods.executeCallback(
      sequenceNumber,
      updateData,
      priceIds,
    );

    const result = await this.chain.estiamteAndSendTransaction(
      transactionObject,
      { from: address },
    );
    return { id: result.transactionHash, info: result };
  }

  // Admin functions
  async generateSetFeeManagerPayload(manager: string): Promise<Buffer> {
    const contract = this.getContract();
    const data = contract.methods.setFeeManager(manager).encodeABI();
    return this.chain.generateExecutorPayload(
      await this.getOwner(),
      this.address,
      data,
    );
  }

  async generateSetDefaultProviderPayload(provider: string): Promise<Buffer> {
    const contract = this.getContract();
    const data = contract.methods.setDefaultProvider(provider).encodeABI();
    return this.chain.generateExecutorPayload(
      await this.getOwner(),
      this.address,
      data,
    );
  }

  async generateSetExclusivityPeriodPayload(
    periodSeconds: number,
  ): Promise<Buffer> {
    const contract = this.getContract();
    const data = contract.methods
      .setExclusivityPeriod(periodSeconds)
      .encodeABI();
    return this.chain.generateExecutorPayload(
      await this.getOwner(),
      this.address,
      data,
    );
  }
}
