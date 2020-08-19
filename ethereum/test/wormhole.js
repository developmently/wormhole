const Wormhole = artifacts.require("Wormhole");
const WrappedAsset = artifacts.require("WrappedAsset");
const ERC20 = artifacts.require("ERC20PresetMinterPauser");

// Taken from https://medium.com/fluidity/standing-the-time-of-test-b906fcc374a9
advanceTimeAndBlock = async (time) => {
    await advanceTime(time);
    await advanceBlock();

    return Promise.resolve(web3.eth.getBlock('latest'));
}

advanceTime = (time) => {
    return new Promise((resolve, reject) => {
        web3.currentProvider.send({
            jsonrpc: "2.0",
            method: "evm_increaseTime",
            params: [time],
            id: new Date().getTime()
        }, (err, result) => {
            if (err) {
                return reject(err);
            }
            return resolve(result);
        });
    });
}

advanceBlock = () => {
    return new Promise((resolve, reject) => {
        web3.currentProvider.send({
            jsonrpc: "2.0",
            method: "evm_mine",
            id: new Date().getTime()
        }, (err, result) => {
            if (err) {
                return reject(err);
            }
            const newBlockHash = web3.eth.getBlock('latest').hash;

            return resolve(newBlockHash)
        });
    });
}

contract("Wormhole", function () {
    it("should use master wrapped asset", async function () {
        let bridge = await Wormhole.deployed();
        let wa = await bridge.wrappedAssetMaster.call();
        assert.equal(wa, WrappedAsset.address)
    });

    it("should transfer tokens in on valid VAA", async function () {
        let bridge = await Wormhole.deployed();

        // User locked an asset on the foreign chain and the VAA proving this is transferred in.
        await bridge.submitVAA("0x01000000000100eecb367540286d326e333ea06542b82d3feaeb0dc33b1b14bda8cdf8287da2a630a9a6692112bcedee501c0947c607081d51426fa1982ef342c07f4502b584c801000007d010000000380102020104000000000000000000000000000000000000000000000000000000000000000000000000000000000090f8bf6a479f320ead074411a4b0e7944ea8c9c1010000000000000000000000000347ef34687bdc9f189e87a9200658d9c40e99880000000000000000000000000000000000000000000000000de0b6b3a7640000")
        // Expect user to have a balance of a new wrapped asset

        // submitVAA has automatically created a new WrappedAsset for the foreign asset that has been transferred in.
        // We know the address because deterministic network. A user would see the address in the submitVAA tx log.
        let wa = new WrappedAsset("0x3c63250aFA2470359482d98749f2d60D2971c818");
        assert.equal(await wa.assetChain(), 1)
        // Remote asset's contract address.
        assert.equal(await wa.assetAddress(), "0x0000000000000000000000000347ef34687bdc9f189e87a9200658d9c40e9988")
        // Account that the user requests the transfer to.
        let balance = await wa.balanceOf("0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1");
        assert.equal(balance, "1000000000000000000");
    });

    it("should not accept the same VAA twice", async function () {
        let bridge = await Wormhole.deployed();
        try {
            await bridge.submitVAA("0x01000000000100eecb367540286d326e333ea06542b82d3feaeb0dc33b1b14bda8cdf8287da2a630a9a6692112bcedee501c0947c607081d51426fa1982ef342c07f4502b584c801000007d010000000380102020104000000000000000000000000000000000000000000000000000000000000000000000000000000000090f8bf6a479f320ead074411a4b0e7944ea8c9c1010000000000000000000000000347ef34687bdc9f189e87a9200658d9c40e99880000000000000000000000000000000000000000000000000de0b6b3a7640000");
        } catch (e) {
            assert.equal(e.reason, "VAA was already executed")
            return
        }
        assert.fail("did not fail")
    });

    it("should burn tokens on lock", async function () {
        let bridge = await Wormhole.deployed();
        // Expect user to have a balance
        let wa = new WrappedAsset("0x3c63250aFA2470359482d98749f2d60D2971c818")

        await bridge.lockAssets(wa.address, "500000000000000000", "0x0", 2);
        let balance = await wa.balanceOf("0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1");

        // Expect user balance to decrease
        assert.equal(balance, "500000000000000000");

        // Expect contract balance to be 0 since tokens have been burned
        balance = await wa.balanceOf(bridge.address);
        assert.equal(balance, "0");
    });

    it("should transfer tokens in and out", async function () {
        let bridge = await Wormhole.deployed();
        let token = await ERC20.new("Test Token", "TKN");

        await token.mint("0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1", "1000000000000000000");
        // Expect user to have a balance
        assert.equal(await token.balanceOf("0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1"), "1000000000000000000");

        // Approve bridge
        await token.approve(bridge.address, "1000000000000000000");

        // Transfer of that token out of the contract should not work
        let threw = false;
        try {
            await bridge.submitVAA("0x01000000000100e2d8610a6cf10587ba2e4f43dc639eeacd3fb4297338955b00b7653094278082505de82418b9e0925d9dd889d0850252aa7c613e63c8b2c27ff22c0001c6336600000007d010000000380102020104000000000000000000000000000000000000000000000000000000000000000000000000000000000090f8bf6a479f320ead074411a4b0e7944ea8c9c102000000000000000000000000d833215cbcc3f914bd1c9ece3ee7bf8b14f841bb0000000000000000000000000000000000000000000000000de0b6b3a7640000");
        } catch (e) {
            threw = true;
        }
        assert.isTrue(threw);

        // Lock assets
        let ev = await bridge.lockAssets(token.address, "1000000000000000000", "0x1230000000000000000000000000000000000000000000000000000000000000", 3);

        // Check that the lock event was emitted correctly
        assert.lengthOf(ev.logs, 1)
        assert.equal(ev.logs[0].event, "LogTokensLocked")
        assert.equal(ev.logs[0].args.target_chain, "3")
        assert.equal(ev.logs[0].args.token_chain, "2")
        assert.equal(ev.logs[0].args.token, "0x000000000000000000000000d833215cbcc3f914bd1c9ece3ee7bf8b14f841bb")
        assert.equal(ev.logs[0].args.sender, "0x00000000000000000000000090f8bf6a479f320ead074411a4b0e7944ea8c9c1")
        assert.equal(ev.logs[0].args.recipient, "0x1230000000000000000000000000000000000000000000000000000000000000")
        assert.equal(ev.logs[0].args.amount, "1000000000000000000")

        // Check that the tokens were transferred to the bridge
        assert.equal(await token.balanceOf("0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1"), "0");
        assert.equal(await token.balanceOf(bridge.address), "1000000000000000000");

        // Transfer this token back
        await bridge.submitVAA("0x01000000000100e2d8610a6cf10587ba2e4f43dc639eeacd3fb4297338955b00b7653094278082505de82418b9e0925d9dd889d0850252aa7c613e63c8b2c27ff22c0001c6336600000007d010000000380102020104000000000000000000000000000000000000000000000000000000000000000000000000000000000090f8bf6a479f320ead074411a4b0e7944ea8c9c102000000000000000000000000d833215cbcc3f914bd1c9ece3ee7bf8b14f841bb0000000000000000000000000000000000000000000000000de0b6b3a7640000");
        assert.equal(await token.balanceOf("0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1"), "1000000000000000000");
        assert.equal(await token.balanceOf(bridge.address), "0");
    });

    it("should accept validator set change", async function () {
        let bridge = await Wormhole.deployed();

        // Push time by 1000
        await advanceTimeAndBlock(1000);
        let ev = await bridge.submitVAA("0x01000000000100a33c022217ccb87a5bc83b71e6377fff6639e7904d9e9995a42dc0867dc2b0bc5d1aacc3752ea71cf4d85278526b5dd40b0343667a2d4434a44cbf7844181a1000000007d0010000000101e06a9adfeb38a8ee4d00e89307c016d0749679bd")
        assert.lengthOf(ev.logs, 1)
        assert.equal(ev.logs[0].event, "LogGuardianSetChanged")

        // Expect guardian set to transition to 1
        assert.equal(await bridge.guardian_set_index(), 1);
    });

    it("should not accept guardian set change from old guardians", async function () {
        let bridge = await Wormhole.deployed();

        // Test update guardian set VAA from guardian set 0; timestamp 2000
        let threw = false;
        try {
            await bridge.submitVAA("0x01000000000100d90d6f9cbc0458599cbe4d267bc9221b54955b94cb5cb338aeb845bdc9dd275f558871ea479de9cc0b44cfb2a07344431a3adbd2f98aa86f4e12ff4aba061b7f00000007d00100000001018575df9b3c97b4e267deb92d93137844a97a0132")
        } catch (e) {
            threw = true;
            assert.equal(e.reason, "only the current guardian set can change the guardian set")
        }
        assert.isTrue(threw, "old guardian set could make changes")
    });

    it("should time out guardians", async function () {
        let bridge = await Wormhole.deployed();

        // Test VAA from guardian set 0; timestamp 1000
        await bridge.submitVAA("0x0100000000010000b61ecc7b9de12de6fc7f01d8a89f8c2911329e44198d0a47768344c69eadd510fd5ab6474a24aa11a6751465fb4e2f8c81a4dbc2fc2427b4c5a981e8e63ed900000003e810000000380102020104000000000000000000000000000000000000000000000000000000000000000000000000000000000090f8bf6a479f320ead074411a4b0e7944ea8c9c1010000000000000000000000000347ef34687bdc9f189e87a9200658d9c40e99880000000000000000000000000000000000000000000000000de0b6b3a7640000")

        await advanceTimeAndBlock(1000);

        // Test VAA from guardian set 0; timestamp 2000 - should not work anymore
        let threw = false;
        try {
            await bridge.submitVAA("0x01000000000100b7e82826980fb9f2389a6e22f7db12d5872e7900775c2c5d6ad1c3558ee7a1314f0f7f171cad73caaac0599c8914009ea9d0ef0e416404b141f844b85a5d254701000007d010000000380102020105000000000000000000000000000000000000000000000000000000000000000000000000000000000090f8bf6a479f320ead074411a4b0e7944ea8c9c1010000000000000000000000000347ef34687bdc9f189e87a9200658d9c40e99880000000000000000000000000000000000000000000000000de0b6b3a7640000")
        } catch (e) {
            threw = true;
            assert.equal(e.reason, "guardian set has expired")
        }
        assert.isTrue(threw, "guardian set did not expire")

        // Test same transaction with guardian set 1; timestamp 2000
        await bridge.submitVAA("0x01000000010100a3f58fb72b3c7e242d6934718eafb3076cb0764e65d8df3e0746b0c72cca791027ac649fa0095a1c3537611f4adc0dc90aaa01fce31fac722eae898cfb06e96d01000007d010000000380102020105000000000000000000000000000000000000000000000000000000000000000000000000000000000090f8bf6a479f320ead074411a4b0e7944ea8c9c1010000000000000000000000000347ef34687bdc9f189e87a9200658d9c40e99880000000000000000000000000000000000000000000000000de0b6b3a7640000")
    });

    it("should expire VAA", async function () {
        let bridge = await Wormhole.deployed();

        // Push time by 1000
        await advanceTimeAndBlock(1000);

        // Test same transaction with guardian set 1; timestamp 2000
        let threw = false;
        try {
            await bridge.submitVAA("0x01000000010100f69b3f6e31fbbe6ce9b9b1be8e8effded63b44ab8d7d2dc993c914d50d4bb6fe75cdf6ebb15e5bf209f2ea608e496283d8ff5a91a102f1cab42e9093cbb50b6201000007d01087000000360102020104000000000000000000000000000000000000000000000000000000000000000000000000000000000090f8bf6a479f320ead074411a4b0e7944ea8c9c1010000000000000000000000009561c133dd8580860b6b7e504bc5aa500f0f06a70000000000000000000000000000000000000000000000000de0b6b3a7640000")
        } catch (e) {
            threw = true;
            assert.equal(e.reason, "VAA has expired")
        }
        assert.isTrue(threw, "VAA did not expire")
    });


    it("mismatching guardian set and signature should not work", async function () {
        let bridge = await Wormhole.deployed();

        // Test VAA signed by guardian set 0 but set guardian set index to 1
        let threw = false;
        try {
            await bridge.submitVAA("0x010000000101006f84df72f3f935543e9bda60d92f77e2e2c073655311f3fc00518bbe7e054ff87e5e6e3c9df9e5bd756ee033253d4513ddebf03ff844fdc0f48f7dcc1b3fd6e10000000fa01087000000370102020104000000000000000000000000000000000000000000000000000000000000000000000000000000000090f8bf6a479f320ead074411a4b0e7944ea8c9c1010000000000000000000000009561c133dd8580860b6b7e504bc5aa500f0f06a70000000000000000000000000000000000000000000000000de0b6b3a7640000")
        } catch (e) {
            threw = true;
            assert.equal(e.reason, "VAA signature invalid")
        }
        assert.isTrue(threw, "invalid signature accepted")
    });

    it("quorum should be honored", async function () {
        let bridge = await Wormhole.deployed();

        // Update to validator set 2 with 6 signers
        await bridge.submitVAA("0x010000000101007a8681fbb4eb93fe71d2608bacdd6ac8d7f07987d531435fc4e0e9224fcf5d087991860eb61b73671db864e7b33894ec82f7ffb17ba5a888712fb6be11df4b030100000fa0010000000206befa429d57cd18b7f8a4d91a2da9ab4af05d0fbee06a9adfeb38a8ee4d00e89307c016d0749679bd8575df9b3c97b4e267deb92d93137844a97a01320427cda59902dc6eb0c1bd2b6d38f87c5552b348bfea822f75c42e1764c791b8fe04a7b10ddb38572f5fe0b158147e7260f14062556afc94eece55ff")

        // Test VAA signed by only 3 signers
        let threw = false;
        try {
            await bridge.submitVAA("0x010000000203001dbccdb06c91929042b20a136d226890e22b07120d2854aa5c17bc1cce934cf66e2f5e31a3d883bc928346c35352a7627fb0aa7e420b73a89dc0c205780f98bc0001eadd27047cb0988ed4a7c681af758e88c628f2a3c424186044e3fd9ad8c3425f401bfc29674db720f62f08a251ff6aa3b982adb57186422cdad03cc4bfc07bb001020193d92acf2ecadad96273f122ada995700225c18d65db636db7f52e2c77906e3e0153a163c4d123b68f78cc1a8c5dbd4bdf1a26718cfc850c8278ec4a39bb470100000fa010000000390102020105000000000000000000000000000000000000000000000000000000000000000000000000000000000090f8bf6a479f320ead074411a4b0e7944ea8c9c1010000000000000000000000000347ef34687bdc9f189e87a9200658d9c40e99880000000000000000000000000000000000000000000000000de0b6b3a7640000")
        } catch (e) {
            threw = true;
            assert.equal(e.reason, "no quorum")
        }
        assert.isTrue(threw, "accepted only 3 signatures")

        // Test VAA signed by 5 signers (all except i=3)
        await bridge.submitVAA("0x010000000205001dbccdb06c91929042b20a136d226890e22b07120d2854aa5c17bc1cce934cf66e2f5e31a3d883bc928346c35352a7627fb0aa7e420b73a89dc0c205780f98bc0001eadd27047cb0988ed4a7c681af758e88c628f2a3c424186044e3fd9ad8c3425f401bfc29674db720f62f08a251ff6aa3b982adb57186422cdad03cc4bfc07bb0010393f4821a0fc8248ad8eccfb6e1b6a1fb70d0294a6a2b53cb6e222205f3d9f960491fdda4e23e2dde46b084f4ac101050deecbe871eeec218217037d7974b41a301049571b8d3fbcebad1e868331570120a27cf122d33f3d5b95355fde3712ecdbd5233888ec51e5d9e960beaa9a0697f5ac69f9deae37782b874fbe8aecf064087e00105ddd37a55e2a654f5898b1863eaf8efa464797bfa602893d0bcbcc06269df6a3b4ba88c01f3ad22d23a02c8dc1cb34d28b6eb4dd3e2030b8b42ff6909537faf430000000fa010000000390102020105000000000000000000000000000000000000000000000000000000000000000000000000000000000090f8bf6a479f320ead074411a4b0e7944ea8c9c1010000000000000000000000000347ef34687bdc9f189e87a9200658d9c40e99880000000000000000000000000000000000000000000000000de0b6b3a7640000")
    });
});
