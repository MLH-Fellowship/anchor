import * as anchor from "@project-serum/anchor";
import { Program, BN, IdlAccounts, AnchorError } from "@project-serum/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  Token,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Misc } from "../target/types/misc";
import { Misc2 } from "../target/types/misc2";
const utf8 = anchor.utils.bytes.utf8;
const { assert } = require("chai");
const nativeAssert = require("assert");
const miscIdl = require("../target/idl/misc.json");

describe("misc", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.Misc as Program<Misc>;
  const misc2Program = anchor.workspace.Misc2 as Program<Misc2>;

  it("Can allocate extra space for a state constructor", async () => {
    const tx = await program.state.rpc.new();
    const addr = await program.state.address();
    const state = await program.state.fetch();
    const accountInfo = await program.provider.connection.getAccountInfo(addr);
    assert.isTrue(state.v.equals(Buffer.from([])));
    assert.lengthOf(accountInfo.data, 99);
  });

  it("Can use remaining accounts for a state instruction", async () => {
    await program.state.rpc.remainingAccounts({
      remainingAccounts: [
        { pubkey: misc2Program.programId, isWritable: false, isSigner: false },
      ],
    });
  });

  const data = anchor.web3.Keypair.generate();
  it("Can use u128 and i128", async () => {
    const tx = await program.rpc.initialize(
      new anchor.BN(1234),
      new anchor.BN(22),
      {
        accounts: {
          data: data.publicKey,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        signers: [data],
        instructions: [await program.account.data.createInstruction(data)],
      }
    );
    const dataAccount = await program.account.data.fetch(data.publicKey);
    assert.isTrue(dataAccount.udata.eq(new anchor.BN(1234)));
    assert.isTrue(dataAccount.idata.eq(new anchor.BN(22)));
  });
  it("Can use u16", async () => {
    const data = anchor.web3.Keypair.generate();
    const tx = await program.rpc.testU16(99, {
      accounts: {
        myAccount: data.publicKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      },
      signers: [data],
      instructions: [await program.account.dataU16.createInstruction(data)],
    });
    const dataAccount = await program.account.dataU16.fetch(data.publicKey);
    assert.strictEqual(dataAccount.data, 99);
  });

  it("Can embed programs into genesis from the Anchor.toml", async () => {
    const pid = new anchor.web3.PublicKey(
      "FtMNMKp9DZHKWUyVAsj3Q5QV8ow4P3fUPP7ZrWEQJzKr"
    );
    let accInfo = await anchor.getProvider().connection.getAccountInfo(pid);
    assert.isTrue(accInfo.executable);
  });

  it("Can use the owner constraint", async () => {
    await program.rpc.testOwner({
      accounts: {
        data: data.publicKey,
        misc: program.programId,
      },
    });

    await nativeAssert.rejects(
      async () => {
        await program.rpc.testOwner({
          accounts: {
            data: program.provider.wallet.publicKey,
            misc: program.programId,
          },
        });
      },
      (err) => {
        return true;
      }
    );
  });

  it("Can use the executable attribute", async () => {
    await program.rpc.testExecutable({
      accounts: {
        program: program.programId,
      },
    });

    await nativeAssert.rejects(
      async () => {
        await program.rpc.testExecutable({
          accounts: {
            program: program.provider.wallet.publicKey,
          },
        });
      },
      (err) => {
        return true;
      }
    );
  });

  it("Can CPI to state instructions", async () => {
    const oldData = new anchor.BN(0);
    await misc2Program.state.rpc.new({
      accounts: {
        authority: program.provider.wallet.publicKey,
      },
    });
    let stateAccount = await misc2Program.state.fetch();
    assert.isTrue(stateAccount.data.eq(oldData));
    assert.isTrue(stateAccount.auth.equals(program.provider.wallet.publicKey));
    const newData = new anchor.BN(2134);
    await program.rpc.testStateCpi(newData, {
      accounts: {
        authority: program.provider.wallet.publicKey,
        cpiState: await misc2Program.state.address(),
        misc2Program: misc2Program.programId,
      },
    });
    stateAccount = await misc2Program.state.fetch();
    assert.isTrue(stateAccount.data.eq(newData));
    assert.isTrue(stateAccount.auth.equals(program.provider.wallet.publicKey));
  });

  it("Can retrieve events when simulating a transaction", async () => {
    const resp = await program.simulate.testSimulate(44);
    const expectedRaw = [
      "Program 3TEqcc8xhrhdspwbvoamUJe2borm4Nr72JxL66k6rgrh invoke [1]",
      "Program log: Instruction: TestSimulate",
      "Program data: NgyCA9omwbMsAAAA",
      "Program data: fPhuIELK/k7SBAAA",
      "Program data: jvbowsvlmkcJAAAA",
      "Program data: zxM5neEnS1kBAgMEBQYHCAkK",
      "Program data: g06Ei2GL1gIBAgMEBQYHCAkKCw==",
      "Program 3TEqcc8xhrhdspwbvoamUJe2borm4Nr72JxL66k6rgrh consumed 5395 of 1400000 compute units",
      "Program 3TEqcc8xhrhdspwbvoamUJe2borm4Nr72JxL66k6rgrh success",
    ];

    assert.deepStrictEqual(expectedRaw, resp.raw);
    assert.strictEqual(resp.events[0].name, "E1");
    assert.strictEqual(resp.events[0].data.data, 44);
    assert.strictEqual(resp.events[1].name, "E2");
    assert.strictEqual(resp.events[1].data.data, 1234);
    assert.strictEqual(resp.events[2].name, "E3");
    assert.strictEqual(resp.events[2].data.data, 9);
    assert.strictEqual(resp.events[3].name, "E5");
    assert.deepStrictEqual(
      resp.events[3].data.data,
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    );
    assert.strictEqual(resp.events[4].name, "E6");
    assert.deepStrictEqual(
      resp.events[4].data.data,
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    );
  });

  let dataI8;

  it("Can use i8 in the idl", async () => {
    dataI8 = anchor.web3.Keypair.generate();
    await program.rpc.testI8(-3, {
      accounts: {
        data: dataI8.publicKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      },
      instructions: [await program.account.dataI8.createInstruction(dataI8)],
      signers: [dataI8],
    });
    const dataAccount = await program.account.dataI8.fetch(dataI8.publicKey);
    assert.strictEqual(dataAccount.data, -3);
  });

  let dataPubkey;

  it("Can use i16 in the idl", async () => {
    const data = anchor.web3.Keypair.generate();
    await program.rpc.testI16(-2048, {
      accounts: {
        data: data.publicKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      },
      instructions: [await program.account.dataI16.createInstruction(data)],
      signers: [data],
    });
    const dataAccount = await program.account.dataI16.fetch(data.publicKey);
    assert.strictEqual(dataAccount.data, -2048);

    dataPubkey = data.publicKey;
  });

  it("Can use base58 strings to fetch an account", async () => {
    const dataAccount = await program.account.dataI16.fetch(
      dataPubkey.toString()
    );
    assert.strictEqual(dataAccount.data, -2048);
  });

  it("Should fail to close an account when sending lamports to itself", async () => {
    try {
      await program.rpc.testClose({
        accounts: {
          data: data.publicKey,
          solDest: data.publicKey,
        },
      });
      assert.ok(false);
    } catch (err) {
      const errMsg = "A close constraint was violated";
      assert.strictEqual(err.error.errorMessage, errMsg);
      assert.strictEqual(err.error.errorCode.number, 2011);
    }
  });

  it("Can close an account", async () => {
    const openAccount = await program.provider.connection.getAccountInfo(
      data.publicKey
    );
    assert.isNotNull(openAccount);

    let beforeBalance = (
      await program.provider.connection.getAccountInfo(
        program.provider.wallet.publicKey
      )
    ).lamports;

    await program.rpc.testClose({
      accounts: {
        data: data.publicKey,
        solDest: program.provider.wallet.publicKey,
      },
    });

    let afterBalance = (
      await program.provider.connection.getAccountInfo(
        program.provider.wallet.publicKey
      )
    ).lamports;

    // Retrieved rent exemption sol.
    assert.ok(afterBalance > beforeBalance);

    const closedAccount = await program.provider.connection.getAccountInfo(
      data.publicKey
    );
    assert.isNull(closedAccount);
  });


  it("Can execute a fallback function", async () => {
    await nativeAssert.rejects(
      async () => {
        await anchor.utils.rpc.invoke(program.programId);
      },
      (err) => {
        assert.isTrue(err.toString().includes("custom program error: 0x4d2"));
        return true;
      }
    );
  }); 
  
  it("Can initialize multiple accounts via a composite payer", async () => {
    const data1 = anchor.web3.Keypair.generate();
    const data2 = anchor.web3.Keypair.generate();

    const tx = await program.rpc.testCompositePayer({
      accounts: {
        composite: {
          data: data1.publicKey,
          payer: program.provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        },
        data: data2.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      },
      signers: [data1, data2],
    });

    const account1 = await program.account.dataI8.fetch(data1.publicKey);
    assert.strictEqual(account1.data, 1);

    const account2 = await program.account.data.fetch(data2.publicKey);
    assert.strictEqual(account2.udata.toNumber(), 2);
    assert.strictEqual(account2.idata.toNumber(), 3);
  });

  it("Can fetch all accounts of a given type", async () => {
    // Initialize the accounts.
    const data1 = anchor.web3.Keypair.generate();
    const data2 = anchor.web3.Keypair.generate();
    const data3 = anchor.web3.Keypair.generate();
    const data4 = anchor.web3.Keypair.generate();
    // Initialize filterable data.
    const filterable1 = anchor.web3.Keypair.generate().publicKey;
    const filterable2 = anchor.web3.Keypair.generate().publicKey;
    // Set up a secondary wallet and program.
    const anotherProgram = new anchor.Program(
      miscIdl,
      program.programId,
      new anchor.Provider(
        program.provider.connection,
        new anchor.Wallet(anchor.web3.Keypair.generate()),
        { commitment: program.provider.connection.commitment }
      )
    );
    // Request airdrop for secondary wallet.
    const signature = await program.provider.connection.requestAirdrop(
      anotherProgram.provider.wallet.publicKey,
      anchor.web3.LAMPORTS_PER_SOL
    );
    await program.provider.connection.confirmTransaction(signature);
    // Create all the accounts.
    await Promise.all([
      program.rpc.testFetchAll(filterable1, {
        accounts: {
          data: data1.publicKey,
          authority: program.provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        },
        signers: [data1],
      }),
      program.rpc.testFetchAll(filterable1, {
        accounts: {
          data: data2.publicKey,
          authority: program.provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        },
        signers: [data2],
      }),
      program.rpc.testFetchAll(filterable2, {
        accounts: {
          data: data3.publicKey,
          authority: program.provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        },
        signers: [data3],
      }),
      anotherProgram.rpc.testFetchAll(filterable1, {
        accounts: {
          data: data4.publicKey,
          authority: anotherProgram.provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        },
        signers: [data4],
      }),
    ]);
    // Call for multiple kinds of .all.
    const allAccounts = await program.account.dataWithFilter.all();
    const allAccountsFilteredByBuffer =
      await program.account.dataWithFilter.all(
        program.provider.wallet.publicKey.toBuffer()
      );
    const allAccountsFilteredByProgramFilters1 =
      await program.account.dataWithFilter.all([
        {
          memcmp: {
            offset: 8,
            bytes: program.provider.wallet.publicKey.toBase58(),
          },
        },
        { memcmp: { offset: 40, bytes: filterable1.toBase58() } },
      ]);
    const allAccountsFilteredByProgramFilters2 =
      await program.account.dataWithFilter.all([
        {
          memcmp: {
            offset: 8,
            bytes: program.provider.wallet.publicKey.toBase58(),
          },
        },
        { memcmp: { offset: 40, bytes: filterable2.toBase58() } },
      ]);
    // Without filters there should be 4 accounts.
    assert.lengthOf(allAccounts, 4);
    // Filtering by main wallet there should be 3 accounts.
    assert.lengthOf(allAccountsFilteredByBuffer, 3);
    // Filtering all the main wallet accounts and matching the filterable1 value
    // results in a 2 accounts.
    assert.lengthOf(allAccountsFilteredByProgramFilters1, 2);
    // Filtering all the main wallet accounts and matching the filterable2 value
    // results in 1 account.
    assert.lengthOf(allAccountsFilteredByProgramFilters2, 1);
  });

  it("Can use pdas with empty seeds", async () => {
    const [pda, bump] = await PublicKey.findProgramAddress(
      [],
      program.programId
    );

    await program.rpc.testInitWithEmptySeeds({
      accounts: {
        pda: pda,
        authority: program.provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      },
    });
    await program.rpc.testEmptySeedsConstraint({
      accounts: {
        pda: pda,
      },
    });

    const [pda2, bump2] = await PublicKey.findProgramAddress(
      ["non-empty"],
      program.programId
    );
    await nativeAssert.rejects(
      program.rpc.testEmptySeedsConstraint({
        accounts: {
          pda: pda2,
        },
      }),
      (err) => {
        assert.equal(err.error.errorCode.number, 2006);
        return true;
      }
    );
  });

  const ifNeededAcc = anchor.web3.Keypair.generate();

  it("Can init if needed a new account", async () => {
    await program.rpc.testInitIfNeeded(1, {
      accounts: {
        data: ifNeededAcc.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        payer: program.provider.wallet.publicKey,
      },
      signers: [ifNeededAcc],
    });
    const account = await program.account.dataU16.fetch(ifNeededAcc.publicKey);
    assert.strictEqual(account.data, 1);
  });

  it("Can init if needed a previously created account", async () => {
    await program.rpc.testInitIfNeeded(3, {
      accounts: {
        data: ifNeededAcc.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        payer: program.provider.wallet.publicKey,
      },
      signers: [ifNeededAcc],
    });
    const account = await program.account.dataU16.fetch(ifNeededAcc.publicKey);
    assert.strictEqual(account.data, 3);
  });

  it("Can use const for array size", async () => {
    const data = anchor.web3.Keypair.generate();
    const tx = await program.rpc.testConstArraySize(99, {
      accounts: {
        data: data.publicKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      },
      signers: [data],
      instructions: [
        await program.account.dataConstArraySize.createInstruction(data),
      ],
    });
    const dataAccount = await program.account.dataConstArraySize.fetch(
      data.publicKey
    );
    assert.deepStrictEqual(dataAccount.data, [99, ...new Array(9).fill(0)]);
  });

  it("Can use const for instruction data size", async () => {
    const data = anchor.web3.Keypair.generate();
    const dataArray = [99, ...new Array(9).fill(0)];
    const tx = await program.rpc.testConstIxDataSize(dataArray, {
      accounts: {
        data: data.publicKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      },
      signers: [data],
      instructions: [
        await program.account.dataConstArraySize.createInstruction(data),
      ],
    });
    const dataAccount = await program.account.dataConstArraySize.fetch(
      data.publicKey
    );
    assert.deepStrictEqual(dataAccount.data, dataArray);
  });

  it("Should include BASE const in IDL", async () => {
    assert.isDefined(
      miscIdl.constants.find(
        (c) => c.name === "BASE" && c.type === "u128" && c.value === "1_000_000"
      )
    );
  });

  it("Should include DECIMALS const in IDL", async () => {
    assert.isDefined(
      miscIdl.constants.find(
        (c) => c.name === "DECIMALS" && c.type === "u8" && c.value === "6"
      )
    );
  });

  it("Should not include NO_IDL const in IDL", async () => {
    assert.isUndefined(miscIdl.constants.find((c) => c.name === "NO_IDL"));
  });
  
  it("init_if_needed throws if associated token exists but has the wrong owner", async () => {
    const mint = Keypair.generate();
    await program.rpc.testInitMint({
      accounts: {
        mint: mint.publicKey,
        payer: program.provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      },
      signers: [mint],
    });

    const associatedToken = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      anchor.utils.token.TOKEN_PROGRAM_ID,
      mint.publicKey,
      program.provider.wallet.publicKey
    );

    await program.rpc.testInitAssociatedToken({
      accounts: {
        token: associatedToken,
        mint: mint.publicKey,
        payer: program.provider.wallet.publicKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      },
    });

    try {
      await program.rpc.testInitAssociatedTokenIfNeeded({
        accounts: {
          token: associatedToken,
          mint: mint.publicKey,
          payer: program.provider.wallet.publicKey,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          authority: anchor.web3.Keypair.generate().publicKey,
        },
      });
      assert.ok(false);
    } catch (_err) {
      assert.isTrue(_err instanceof AnchorError);
      const err: AnchorError = _err;
      assert.strictEqual(err.error.errorCode.number, 2015);
    }
  });
  it("init_if_needed throws if associated token exists but has the wrong mint", async () => {
    const mint = anchor.web3.Keypair.generate();
    await program.rpc.testInitMint({
      accounts: {
        mint: mint.publicKey,
        payer: program.provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      },
      signers: [mint],
    });

    const mint2 = anchor.web3.Keypair.generate();
    await program.rpc.testInitMint({
      accounts: {
        mint: mint2.publicKey,
        payer: program.provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      },
      signers: [mint2],
    });

    const associatedToken = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      anchor.utils.token.TOKEN_PROGRAM_ID,
      mint.publicKey,
      program.provider.wallet.publicKey
    );

    await program.rpc.testInitAssociatedToken({
      accounts: {
        token: associatedToken,
        mint: mint.publicKey,
        payer: program.provider.wallet.publicKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      },
    });

    try {
      await program.rpc.testInitAssociatedTokenIfNeeded({
        accounts: {
          token: associatedToken,
          mint: mint2.publicKey,
          payer: program.provider.wallet.publicKey,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          authority: program.provider.wallet.publicKey,
        },
      });
      assert.ok(false);
    } catch (_err) {
      assert.isTrue(_err instanceof AnchorError);
      const err: AnchorError = _err;
      assert.strictEqual(err.error.errorCode.number, 2014);
    }
  });
  it("init_if_needed throws if token exists with correct owner and mint but is not the ATA", async () => {
    const mint = anchor.web3.Keypair.generate();
    await program.rpc.testInitMint({
      accounts: {
        mint: mint.publicKey,
        payer: program.provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      },
      signers: [mint],
    });

    const associatedToken = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      anchor.utils.token.TOKEN_PROGRAM_ID,
      mint.publicKey,
      program.provider.wallet.publicKey
    );

    await program.rpc.testInitAssociatedToken({
      accounts: {
        token: associatedToken,
        mint: mint.publicKey,
        payer: program.provider.wallet.publicKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      },
    });

    const token = anchor.web3.Keypair.generate();
    await program.rpc.testInitToken({
      accounts: {
        token: token.publicKey,
        mint: mint.publicKey,
        payer: program.provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      },
      signers: [token],
    });

    try {
      await program.rpc.testInitAssociatedTokenIfNeeded({
        accounts: {
          token: token.publicKey,
          mint: mint.publicKey,
          payer: program.provider.wallet.publicKey,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          authority: program.provider.wallet.publicKey,
        },
      });
      assert.ok(false);
    } catch (_err) {
      assert.isTrue(_err instanceof AnchorError);
      const err: AnchorError = _err;
      assert.strictEqual(err.error.errorCode.number, 3014);
    }
  });

  it("Can use multidimensional array", async () => {
    const array2d = new Array(10).fill(new Array(10).fill(99));
    const data = anchor.web3.Keypair.generate();
    await program.rpc.testMultidimensionalArray(array2d, {
      accounts: {
        data: data.publicKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      },
      signers: [data],
      instructions: [
        await program.account.dataMultidimensionalArray.createInstruction(data),
      ],
    });
    const dataAccount = await program.account.dataMultidimensionalArray.fetch(
      data.publicKey
    );
    assert.deepStrictEqual(dataAccount.data, array2d);
  });

  it("Can use multidimensional array with const sizes", async () => {
    const array2d = new Array(10).fill(new Array(11).fill(22));
    const data = anchor.web3.Keypair.generate();
    await program.rpc.testMultidimensionalArrayConstSizes(array2d, {
      accounts: {
        data: data.publicKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      },
      signers: [data],
      instructions: [
        await program.account.dataMultidimensionalArrayConstSizes.createInstruction(
          data
        ),
      ],
    });
    const dataAccount =
      await program.account.dataMultidimensionalArrayConstSizes.fetch(
        data.publicKey
      );
    assert.deepStrictEqual(dataAccount.data, array2d);
  });

  describe("Can validate PDAs derived from other program ids", () => {
    it("With bumps using create_program_address", async () => {
      const [firstPDA, firstBump] =
        await anchor.web3.PublicKey.findProgramAddress(
          [anchor.utils.bytes.utf8.encode("seed")],
          ASSOCIATED_TOKEN_PROGRAM_ID
        );
      const [secondPDA, secondBump] =
        await anchor.web3.PublicKey.findProgramAddress(
          [anchor.utils.bytes.utf8.encode("seed")],
          program.programId
        );

      // correct bump but wrong address
      const wrongAddress = anchor.web3.Keypair.generate().publicKey;
      try {
        await program.rpc.testProgramIdConstraint(firstBump, secondBump, {
          accounts: {
            first: wrongAddress,
            second: secondPDA,
          },
        });
        assert.ok(false);
      } catch (_err) {
        assert.isTrue(_err instanceof AnchorError);
        const err: AnchorError = _err;
        assert.strictEqual(err.error.errorCode.number, 2006);
      }

      // matching bump seed for wrong address but derived from wrong program
      try {
        await program.rpc.testProgramIdConstraint(secondBump, secondBump, {
          accounts: {
            first: secondPDA,
            second: secondPDA,
          },
        });
        assert.ok(false);
      } catch (_err) {
        assert.isTrue(_err instanceof AnchorError);
        const err: AnchorError = _err;
        assert.strictEqual(err.error.errorCode.number, 2006);
      }

      // correct inputs should lead to successful tx
      await program.rpc.testProgramIdConstraint(firstBump, secondBump, {
        accounts: {
          first: firstPDA,
          second: secondPDA,
        },
      });
    });

    it("With bumps using find_program_address", async () => {
      const firstPDA = (
        await anchor.web3.PublicKey.findProgramAddress(
          [anchor.utils.bytes.utf8.encode("seed")],
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      )[0];
      const secondPDA = (
        await anchor.web3.PublicKey.findProgramAddress(
          [anchor.utils.bytes.utf8.encode("seed")],
          program.programId
        )
      )[0];

      // random wrong address
      const wrongAddress = anchor.web3.Keypair.generate().publicKey;
      try {
        await program.rpc.testProgramIdConstraintFindPda({
          accounts: {
            first: wrongAddress,
            second: secondPDA,
          },
        });
        assert.ok(false);
      } catch (_err) {
        assert.isTrue(_err instanceof AnchorError);
        const err: AnchorError = _err;
        assert.strictEqual(err.error.errorCode.number, 2006);
      }

      // same seeds but derived from wrong program
      try {
        await program.rpc.testProgramIdConstraintFindPda({
          accounts: {
            first: secondPDA,
            second: secondPDA,
          },
        });
        assert.ok(false);
      } catch (_err) {
        assert.isTrue(_err instanceof AnchorError);
        const err: AnchorError = _err;
        assert.strictEqual(err.error.errorCode.number, 2006);
      }

      // correct inputs should lead to successful tx
      await program.rpc.testProgramIdConstraintFindPda({
        accounts: {
          first: firstPDA,
          second: secondPDA,
        },
      });
    });
  });
});
