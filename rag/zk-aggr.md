---
abstract: |
  Unicity is a novel blockchain protocol with the ambitious goal of
  enabling token transactions to occur off-chain and, when necessary,
  offline. This premise requires supporting infrastructure to guarantee
  that there are no parallel states of assets, or more specifically,
  that there is no double-spending; a property we term the *unicity*. It
  turns out that the lack of globally shared state and ordering reduces
  the blockchain overhead considerably. In designing this
  infrastructure, no compromises were made regarding its trust
  assumptions. This paper details the design of the Aggregation Layer,
  the component responsible for producing Proofs of Inclusion and
  Non-inclusion to the users. We analyze its design for efficiency and
  evaluate the robustness of its trust and security model, and gains
  offered by cryptographic zero-knowledge tools.
author:
- Risto Laanoja
bibliography:
- aggregation-layer.bib
date: 2026-02-06
title: |
  Unicity Infrastructure:\
  the Aggregation Layer
---

# Motivation

The foundational principle of the Unicity Network [@wp] is to minimize
the volume of on-chain data. This is based on the observation that
shared ("on-chain") state is unavoidable only to prevent
double-spending.[^1] The core tenets of Unicity also include minimizing
trust requirements, enhancing user privacy, and providing linear scale.

In a hierarchical trustless system, the principle is that the base layer
(e.g., L1 blockchain) provides decentralization, while the layers below
it (e.g., rollups) present cryptographic proofs of the correctness of
their operation. In scaling Unicity, we have designed efficient data
structures to prove the correctness of operation of Aggregation Layer to
the Consensus Layer. Based on cryptographic hashes alone, the
consistency proof grows linearly with respect to the number of user
transactions. This imposes a hard limit of approx. $10\,000$
transactions per second (tx/s), beyond which the networking bandwidth of
the Consensus Layer becomes the bottleneck.

To scale further, we must use cryptographic zero-knowledge proofs (ZKPs)
to compress the size of the consistency proofs. As an application of
ZKPs, this use-case is fundamentally more efficient than using ZKPs to
process the transaction data itself, as is done in many privacy coins
and ZK-rollups.

In this paper, we show how to scale the Aggregation Layer to $10\,000$
tx/s *per shard*. This figure represents the proving throughput
achievable on a single consumer-class computer. Due to the small proof
size and efficient verification, the Consensus Layer can support a
practically unlimited number of such trustless shards.
Table [\[tab:zk-comparison\]](#tab:zk-comparison){reference-type="ref"
reference="tab:zk-comparison"} compares different ZKP technologies. We
have picked subjectively the most appropriate ZK schemes and supporting
front-ends ("stacks").

::: table*
  --------------------- ----------- ------------ ------- ------------- ----- -------- --
  **ZK Stack**
  **Function**
  **Speed (tx/s)**
  **Size**
  **Asymptotics**
  **Setup**
  **Effort**
  None ("hash based")     SHA-256    10 000^\*^   10MB      $O(n)$      No     N/A
  CIRCOM + Groth16       Poseidon        25       250b      $O(1)$      Yes   Lower
  Gnark + Groth16        Poseidon        30       250b      $O(1)$      Yes    Low
  SP1 zkVM                SHA-256       1.5        2MB    $O(\log n)$   No    Lowest
  Cairo 0 + STwo         Poseidon      60^†^      2.4MB   $O(\log n)$   No    Medium
  Cairo + STwo           Poseidon       100       2.4MB   $O(\log n)$   No    Medium
  AIR + Plonky3^‡^       Poseidon2     10 000     1.7MB   $O(\log n)$   No     High
  AIR + Plonky3          Poseidon2      2500      0.7MB   $O(\log n)$   No     High
  AIR + Plonky3           Blake3        250       1.7MB   $O(\log n)$   No     High
  --------------------- ----------- ------------ ------- ------------- ----- -------- --

^\*^ Bandwidth-limited, no verification effort reduction.\
^†^ Trace generation before proving is impractically slow.\
^‡^ See Section [7.5](#sec:custom-air-circuit){reference-type="ref"
reference="sec:custom-air-circuit"} for details.
:::

The estimated implementation effort reflects the perceived maturity and
learning curve; and the difficulty of producing safe implementations.

# System Architecture

To prevent double-spending of tokens, the Unicity Infrastructure
permanently[^2] records a unique identifier for every spent token state.
This identifier is the cryptographic hash of the token state data. If a
user attempts to double-spend a token, the resulting identifier will be
identical to the one already recorded, making it impossible to obtain a
new Proof of Unicity. A transaction is considered invalid unless it is
accompanied by a valid Proof of Unicity.

The rest of the processing---executing transactions, running smart
contracts, etc.---can happen at the client layer, executed by users or
"agents". Agents are themselves the interested parties in data
availability and transaction validation, and they choose the ordering of
incoming messages for processing. Thus, the Unicity Infrastructure is
relieved of these duties, removing a major scaling bottleneck of
traditional L1 blockchains.

The Unicity Infrastructure operates in a trust-minimized way by
utilizing distributed authenticated data structures and cryptographic
zero-knowledge tools (SNARKs) for extra succinctness of messages and
tokens. The Proof of Unicity is a fresh *proof of inclusion* of the
token state being spent. This can be efficiently generated based on a
Merkle Tree data structure. The proof size is logarithmic with respect
to the tree's capacity, making it highly efficient. If the root of the
tree is securely fixed, the integrity of the rest of the tree can be
verified trustlessly: it is computationally infeasible to generate a
valid inclusion proof for an element not present in the tree, without
changing the root, or breaking underlying cryptographic assumptions. The
infrastructure also supports *non-inclusion proofs*, making it possible
to prove to other parties that a particular token state has not yet been
spent. The Unicity Infrastructure can thus be conceptualized as a
large-scale, distributed Sparse Merkle Tree (SMT). Specifically, the
tree is implemented as an indexed variant with some optimizations. In
this paper, without the loss of generality, we model the distributed
tree as an SMT. Furthermore, an SMT is straightforward to shard: the
tree is partitionable vertically into slices. Leaves remain at their
deterministically computed positions, as an SMT is an indexed data
structure. Each leaf's identifier encodes its address in the tree, and
the leaf's shard address is a prefix of the identifier.

Aggregation Layer connects to the Consensus Layer. For fully trustless
operation, each request is accompanied by a cryptographic proof of SMT
consistency.

<figure id="fig:layers" data-latex-placement="!htbp">

<figcaption>Layered architecture of the Unicity Network.</figcaption>
</figure>

## Consensus Layer

Decentralization is achieved by a Proof-of-Work (PoW) blockchain
instance which manages consensus, including the validator selection for
the BFT finality gadget, implementing the native token, executing the
tokenomics plan, and handling the validator incentives. PoW is
specifically robust during the bootstrapping of a decentralized system:
when the number of validators fluctuates, the financial value of tokens
is low, and token distribution is relatively concentrated. PoW shows
great liveness properties. At the same time, PoW chains do not provide
fast and deterministic finality: many blocks of confirmations are needed
to achieve a reasonable level of certainty. In Unicity, this is
mitigated by including a BFT "finality gadget" which runs rather fast,
and the finality of transactions below is defined by the consensus of
the BFT cluster.

The PoW layer provides permissionlessness, a core property of
decentralized blockchains. Any validator can actively participate in
mining, and blocks are chosen based on the longest-chain rule. By
selecting a PoW mining puzzle that is resistant to acceleration by GPUs
and ASICs (specifically: RandomX [@randomx]), we aim to further
democratize the participation in the network.

PoW chains encounter rollbacks ("reorgs") when alternative chains with a
greater cumulative PoW work emerge. Limiting the maximum length of
alternative chains creates the risk of involuntary forking---both
alternative chains may be too long for a rollback. This risk is
specifically mitigated by a finality gadget. On the other hand, PoW
chains are extremely robust. If any number of validators leave or join
the network, the chain continues to grow, and the block rate eventually
adjusts to the new total mining power. In short, PoW trades liveness for
safety.

The purpose of BFT consensus layer is twofold: 1) to provide
deterministic (one-block) finality for the layers below, and 2) to
achieve a fast and predictable block rate. BFT consensus trades liveness
for safety: it is more fragile, as its liveness depends on a
supermajority (e.g., two thirds) of validators being online and
cooperative at any moment.

The usual way to achieve *permissionless* BFT consensus is to use a
Proof-of-Stake (PoS) setup. This can be delicate, especially during the
launch of a blockchain protocol: there are known weaknesses like
"nothing at stake attack", and risk of centralization. PoW-based
protocols (and longest-chain-rule protocols in general) are more robust
and well-suited for achieving a wide initial token distribution and
establishing token value for effective decentralization.

By combining a PoW chain with a BFT consensus layer, Unicity leverages
the desirable properties of both mechanisms. The PoW chain provides
decentralization, robustness, and high security for the base currency,
while the BFT layer provides fast, deterministic finality for the
Aggregation Layer.

In Unicity, the BFT layer operates at a much higher block rate than the
PoW chain. Validators for the BFT Consensus Layer are selected
infrequently from a pool of recent, high-performing PoW miners, based on
a deterministic algorithm and PoW chain content; anyone can execute the
algorithm to verify the selection. PoW validators may also delegate
their BFT layer validation rights.

Consensus Layer validators receive their block rewards at the ends of
epochs. It is possible to increase economic security by implementing
slashing based on withheld PoW and Consensus Layer block rewards.

### Consensus Roadmap {#sec:consensus-roadmap}

The introduction of economic security mechanisms is a logical step
toward evolving the Consensus Layer into a full Proof-of-Stake (PoS)
system, once the chain is stable and token distribution reasonably
diversified. A PoS system would provide stronger economic security for
the BFT nodes while being more energy-efficient and environmentally
responsible than PoW mining.

The switch to PoS includes the following steps: 1) introducing the
staking mechanism to create economic security for the BFT layer, 2)
alternative ledger for the native token securing and decentralizing the
system, and executing the tokenomics plan there, 3) selecting BFT
validators based on the stake, 4) adjusting incentives (block rewards,
optional slashing), 5) migrating the token balances, and 5) sunsetting
the PoW chain.

## Aggregation Layer

The Aggregation Layer, also known as the Uniqueness Oracle, implements a global, append-only key-value store
that immutably records every spent token state. More specifically, it
provides the following services: 1) recording of key-value tuples where
the key identifies a token state and value is recording some meta-data,
2) returning inclusion proofs of keys, 3) returning non-inclusion proofs
of keys not present in the store.

The Aggregation Layer periodically has its state authenticator certified
by the Consensus Layer.

<figure id="fig:sharding" data-latex-placement="!t">
<img src="pic/layers.png" />
<figcaption>Sharded architecture of the Aggregation Layer.</figcaption>
</figure>

The Aggregation layer is sharded based on keyspace slices and can be
made hierarchical, as shown in
Figure [2](#fig:sharding){reference-type="ref"
reference="fig:sharding"}.

*Proof of non-deletion*: Once a key is set, it has to remain there
forever. Every state change of the Aggregation Layer (or a slice
thereof) is accompanied by a cryptographic proof establishing that
pre-existing keys have not been removed or their values altered, only
new keys were added. The size of this proof is logarithmic with respect
to the tree's capacity and linear with respect to the size of the
inclusion batch. This can be reduced to a constant size using a SNARK.
Assuming correct validation of the non-deletion proof and chaining of
the Aggregation Layer's state roots by the Consensus Layer, the
Aggregation Layer can be considered trustless.

## Execution Layer

The Execution Layer, also known as the Agent Layer, is responsible for
executing transactions and other business logic, using the services of
the Aggregation Layer and Unicity in general.

# Security Model of the Aggregation Layer

The Aggregation Layer implements a distributed, authenticated,
append-only dictionary data structure. It authenticates incoming state
transfer certification requests by verifying that the sender possesses
the private key corresponding to the public key that identifies the
current token owner. The specific authentication protocol is beyond the
scope of this paper.

::: {#def:append-only-accumulator .definition}
**Definition 1** (Consistency). *An append-only accumulator operates in
batches $B = (k_1, k_2, \ldots, k_j)$, accepting new keys. The
append-only accumulator is *consistent*, if 1) during the insertion of a
batch of updates, no existing element was deleted or modified; 2) it is
possible to generate inclusion proofs
$\pi^{\textsf{inc}}_{k \in \{B_1, \dots, B_i\}} = (v_k \leadsto r, c)$
for all previously inserted elements, but not for non-existent elements;
3) it is possible to generate non-inclusion proofs
$\pi^{\overline{\textsf {inc}}}_{k \notin \{B_1, \dots, B_i\}} = (\varnothing_k \leadsto r, c)$
for all elements not so far inserted to the accumulator, and not for
those already inserted.*
:::

When instantiated as a Sparse Merkle Tree (SMT), then $v_k \leadsto r$
is the hash chain from the value at $k$-th position to root $c$, and
$\varnothing_k \leadsto r$ denotes the hash chain from the "empty" value
at $k$-th position to root $c$.

After each batch of additions, the new root of the Aggregation Layer's
SMT is certified by the BFT finality gadget, ensuring its uniqueness and
immutability. This provides a secure trust anchor for all consistency,
inclusion, and non-inclusion proofs. The idealized Consensus Layer is
modeled as
Algorithm [\[alg:consensuslayer\]](#alg:consensuslayer){reference-type="ref"
reference="alg:consensuslayer"}.

<figure id="fig:model" data-latex-placement="!htbp">

<figcaption>Security model of the Aggregation Layer.</figcaption>
</figure>

For efficiency reasons client requests are processed in batches; the
tree is re-calculated and the tree root is certified when a batch is
closed. A batch of client requests is denoted as $B_i$. At the end of
each batch, the Aggregation Layer produces its summary root hash $r_i$
and sends it to the Consensus Layer for certification. A certification
request $(r_i, r_{i-1}, \pi)$ includes: 1) the previous state root hash,
2) the new state root hash, 3) a consistency proof of the changes made
during the batch, and 4) an authenticator that identifies the operator.

The Consensus Layer certifies the request only if it uniquely *extends*
a previously certified state root and the consistency proof is valid. It
returns a certificate $c = (i, r_i, r_{i-1}; s_{\textsf{cl}})$, where
$s_{\textsf{cl}}$ is a signature from the Consensus Layer (e.g., a
threshold signature from the consensus nodes or a proof of inclusion in
a finalized block).

Each state can be extended only once, which prevents forks within the
Aggregation Layer. Each subsequent round extends the most recently
certified state. We model the Consensus Layer as an oracle, as shown in
Algorithm [\[alg:consensuslayer\]](#alg:consensuslayer){reference-type="ref"
reference="alg:consensuslayer"}.

:::: algorithm
::: algorithmic
$r_- \gets \bot$ $i \gets 0$ $\bot$ $r_- \gets r_i$ $i \gets i+1$
$s_{\textsf{cl}} \gets \textsf{sig}_\textsf{cl}(i, r_i, r_{i-1})$
$c = (i, r_i, r_{i-1}; s_{\textsf{cl}})$
:::
::::

The SMT provides users with inclusion and non-inclusion proofs. Each
proof is anchored to a state root certified by the Consensus Layer.

The Consensus Layer must guarantee data availability. If recent state
roots were lost, it would become impossible to reject duplicate state
transition requests, potentially allowing malicious actors to
double-spend against an old, un-extendable state. The Aggregation Layer
itself does not require an internal consensus mechanism; protocols like
Raft could be used for replication and coordination among its redundant
nodes. The decentralized consensus is provided by the external Consensus
Layer.

If each state transition is accompanied by a cryptographic proof of
non-deletion (see
Section [4](#sec:consistency-proof){reference-type="ref"
reference="sec:consistency-proof"}), the Aggregation Layer can be
considered trustless.

## "Maximalist" Security Assumptions

In this model, we assume that users are capable of validating all
aspects of system operation that are relevant to their own assets. This
level of trustlessness is close to the strong guarantees introduced by
Bitcoin [@bitcoin], where each "client" functions as a full validator,
starting from downloading and verifying the blockchain from the genesis
block.

The Root of Trust is the PoW blockchain. A maximalist user maintains a
full node of this chain. This is relatively lightweight, as the
"utility" transactions are executed at the Execution Layer. Upon
receiving a token, the user must be able to efficiently verify the
following:

1.  The token is valid (as elaborated elsewhere),

2.  The Aggregation Layer has not forked,

3.  The Aggregation Layer has not certified conflicting states of the
    same token.

The second point is addressed by validating a unique state root snapshot
embedded in the PoW block header. Since the cumulative state snapshot
appears with a delay, the block can only be considered final after a
snapshot publishing and block confirmation period; hence, maximalist
verification is not instantaneous.

The third point is addressed by auditing the operation of the
Aggregation Layer---specifically, ensuring that no Inclusion Proofs have
been generated for the token that are not reflected in its recorded
history. To achieve this, all non-deletion proofs from the token's
genesis up to its current state must be validated. This is made
efficient through the use of recursive zero-knowledge proofs (ZKPs),
which show that each round's non-deletion proof is valid and that no
rounds were skipped from verification. These recursive proofs are
generated periodically and are made available with some latency.

## Practical Security Assumptions

If we relax the model by assuming that a majority of BFT consensus nodes
exhibit economically rational behavior and do not collude maliciously
with the Aggregation Layer, the user can enjoy significantly more
practical operational parameters. BFT layer forking (case 2 above) or
certifying conflicting states (case 3 above) produces strong
cryptographic evidence which is processed out of the critical path of
serving users.

In this scenario, a transaction is finalized, and an inclusion proof is
returned within a few seconds, allowing the transaction to be
independently verified---without consulting external data[^3]---within
the same timeframe.

The Root of Trust is the set of epoch change records of the BFT
consensus layer. These records grow slowly (few aggregated signatures
per week). When transitioning to proof-of-stake (PoS) consensus (see
Section [2.1.1](#sec:consensus-roadmap){reference-type="ref"
reference="sec:consensus-roadmap"}), the Root of Trust remains the same.

# Non-deletion Proof {#sec:consistency-proof}

A non-deletion proof is a cryptographic construction that validates one
round of operation of the append-only accumulator.

We have the $i$-th batch of insertions $B_i = (k_1, k_2, \dots, k_j)$,
where $k$ is an inserted item; all insertions are applied within a
single operational round. The root hash before the round is $r_{i-1}$,
and after the round is $r_i$. The accumulator is implemented as a Sparse
Merkle Tree (SMT).

The non-deletion proof generation for batch $B_i$ works as follows:

1.  The new leaves in batch $B_i$ are inserted into the SMT.

2.  For each newly inserted leaf, the sibling nodes on the path from the
    leaf to the root are collected. Siblings present or computable from
    other leaves in the batch are discarded. Siblings can be further
    organized by dividing them into layers, for more efficient
    verification. We denote the set as $\pi_i$.

3.  Record $(B_i, r_{i-1}, r_i, \pi_i)$.

Proof verification works as follows:

1.  Verify the authenticity of the state roots $r_{i-1}$ and $r_i$
    (e.g., by checking their certification by the Consensus Layer).

2.  Build an incomplete SMT tree: for each item in $B_i$, insert the
    value of an empty leaf at the appropriate position.

3.  All non-computable siblings needed to compute the root are available
    in $\pi_i$. Compute the root, compare with $r_{i-1}$; if not equal
    then the proof is not valid.

4.  Build again an incomplete SMT tree; for each item in $B_i$, insert
    the value of the key into the appropriate position.

5.  Compute the root based on siblings in $\pi_i$. If the root is not
    equal to $r_i$ then the proof is not valid.

6.  The proof is valid if the checks above passed.

A valid proof demonstrates that, given authentic roots $r_{i-1}$ and
$r_i$, the keys in $B_i$ corresponded to empty leaves prior to the
update, and that after the update, the values in $B_i$ were recorded at
the positions defined by their respective keys, and there were no other
changes.

Complete verification algorithm is presented as
Algorithm [\[alg:verifynondeletion\]](#alg:verifynondeletion){reference-type="ref"
reference="alg:verifynondeletion"}. Note that there are several
assumptions: that the batch is sorted by keys; and the proof is an array
of arrays of tuples, outer array divides siblings into depth layers and
inner array is sorted by keys (first element of tuple).

Due to the sparseness of the SMT we can further improve the encoding,
for example, instead of checking if a node's sibling is the next item in
layer's nodes or the next item in proof array or empty element
otherwise, we just record a number--how many of the next siblings are
empty elements (frequent close to the leaves when SMT is sparsely
populated); and same with siblings (frequent close to the root).

:::: algorithm
::: algorithmic
$p_\varnothing \gets \{(k, \varnothing) \mid (k, v) \in P\}$
$r_\varnothing \gets$ **assert** $r_\varnothing = r_{i-1}$ $r_B \gets$
**assert** $r_B = r_i$ $1$

$p' \gets [\,]$ $m \gets 0 ; n \gets 0$ $(k, v) \gets p[m]$
$k_p \gets \lfloor k / 2 \rfloor$ $\text{is\_right} \gets k \bmod 2$
$k_s \gets 2k_p + (1 - \text{is\_right})$ $v_s \gets p[m+1].v$
$m \gets m + 1$ $v_s \gets \pi[\ell][n].k$ $n \gets n + 1$
$v_s \gets \varnothing$ $v_p \gets h(v_s, v)$ **if** is_right **else**
$h(v, v_s)$ $p' \gets p' \| (k_p, v_p)$ $m \gets m + 1$ $p \gets p'$
**assert** $|p| = 1$ $p[0].v$
:::
::::

# (ZK)-SNARKs

By using an appropriate cryptographic SNARK system, the size of the
non-deletion proof can be reduced to a constant.

The statement to be proven in zero-knowledge is the correct execution of
the non-deletion proof verification algorithm described in the previous
section. The public inputs to the proof (the instance) are the pre- and
post-update roots $(r_{i-1}, r_i)$. The private input (the witness)
$\omega$ is the insertion batch $B_i$ and the set of sibling nodes
(proof) $\pi_i$. While ZK-SNARKs can hide the witness, this
zero-knowledge property is not a requirement for our use case; we are
primarily interested in the proof's succinctness.

In an experiment [@snark], the statement is implemented as a constraint
system $R$ using the CIRCOM domain-specific language. The witness is
generated based on $\pi_i$ and $B_i$, and is supplemented by control
wires that define how individual hashing blocks in the circuit are
connected to the previous layer and to the inputs. If all constraints
are satisfied, the proof is valid.

The proving system used is Groth16 [@cryptoeprint:2016/260], which is
known for its small proof size. The proving time depends on the depth of
the SMT (logarithmic in its capacity) and the maximum size of the
insertion batch. Importantly, the proving effort does not depend on the
total capacity of the SMT, enabling fairly large instantiations.

When the Consensus Layer verifies these succinct proofs, the Aggregation
Layer operates trustlessly. However, certain redundancy is still
required to ensure data availability of the SMT itself.

# Circuit-Based SNARK Definition

Due to the limited expressivity of an arithmetic circuit (e.g., no
data-dependent loops or real branching), the entire computation flow
must be fixed at circuit-creation time. It is therefore helpful to
pre-process the inputs to create a fixed execution trace.

This pre-processing generates a "wiring" signal, which is supplied as
part of the witness. This signal dictates the data flow between the
hashing units within the circuit.

To preprocess the proof:

1.  The hash forest, which includes the proof's sibling nodes and the
    new batch leaves, is flattened.

2.  The nodes are sorted first by layer (from leaves to root) and then
    lexicographically within each layer.

3.  A wiring signal is generated to control the multiplexers (MUXes) at
    the input of each hashing unit in the circuit.

Let the maximum batch size be $k_{max}$ and the SMT depth be $d$. Since
the arithmetic circuit is static, it must be designed to accommodate the
maximum possible batch size, $k_{max}$.

The circuit has two halves, both controlled by the same wiring signal.
It is critical to security that the control signal and the proof are the
same for both halves. The first half of the circuit computes the
pre-update root by treating all leaves in the insertion batch as zero
(the value of empty leaf). The second half computes the post-update root
using the actual values from the batch. The number of hashing units in
each half of the circuit is approximately $O(k_{max} \cdot d)$.

Each hashing unit takes its inputs either from the outputs of the
previous layer's units or from the set of sibling nodes provided in the
proof. The pre-processing step encodes the positions of batch and proof
elements into these control signals, which are then supplied as part of
the witness.

<figure id="fi:smt-circuit" data-latex-placement="!t">
<img src="pic/smt-circuit.drawio.png" style="width:90.0%" />
<figcaption>Circuit structure.</figcaption>
</figure>

Each hashing cell in the circuit, as depicted in
Figure [5](#fi:smt-circuit-cell){reference-type="ref"
reference="fi:smt-circuit-cell"}, is a template consisting of two input
multiplexers and one 2-to-1 compressing hash function.

<figure id="fi:smt-circuit-cell" data-latex-placement="t">
<img src="pic/smt-circuit-cell.drawio.png" />
<figcaption>One hashing cell of the circuit.</figcaption>
</figure>

The MUX inputs for the leaf layer of the first half are connected to a
vector containing:

- The "empty" leaf value ($0$).

- All new leaves in the batch, which are mapped to 'empty' ($0$).

- The "proof" or sibling hashes ($\pi_i$).

The MUX inputs for the leaf layer of the second half are connected to a
vector containing:

- The "empty" leaf value ($0$).

- The batch of new leaves ($I$).

- The identical "proof" or sibling hashes ($\pi_i$).

The MUXes for internal layers are connected to a vector containing:

- The "empty" leaf value ($0$).

- Output hashes from the previous layer's cells.

- The "proof" or sibling hashes ($\pi_i$).

Both halves' MUXes are controlled by the same wiring signal.

## Performance Indication

Initial benchmarks on a consumer laptop (Apple M1) using the Poseidon
hash function indicate a proving throughput of up to $25$ transactions
per second.

# Execution Trace-Based STARK

An alternative to a bespoke arithmetic circuit is to use a
general-purpose zero-knowledge virtual machine (zkVM). In this approach,
the verification logic is written as a traditional imperative program
(e.g., in Rust). The zkVM then generates a proof of correct execution
for that program.

We have implemented the non-deletion proof verification algorithm as a
Rust program [@stark] to be proved by the SP1 zkVM [@sp1]. As a
commitment to the "right" program we use a prover key, generated during
program setup. Its contents are: a commitment to the preprocessed
traces, the starting Program Counter register, the starting global
digest of the program, after incorporating the initial memory; the chip
information, the chip ordering; and prover configuration.

For verification, we obtain the prover key hash and authenticate it
off-band.

After verifying the proof (`client.verify(&proof, &vk)`), we can be sure
that `proof: SP1ProofWithPublicValues` is valid. The proof data
structure embeds its validated "instance", or public parameters. Based
on these parameters we check that indeed, the right thing was executed.
In our case the instance is defined by the old root hash and the new
root hash, which must be authenticated independently (i.e., using the
certificate from Consensus Layer).

The privacy of the witness (the zero-knowledge property) is not a
requirement for this application. The primary goal is to achieve
computational integrity and succinctness. Therefore, while the
underlying technology is often referred to as "ZK", we are using it as a
Scalable Transparent ARgument of Knowledge (STARK).


# Summary

Zero-knowledge proof systems offer a powerful method for creating
succinct proofs of performing some computation, in our case, checking
consistency proofs of a distributed cryptographic data structure. For
use cases with small changesets, a simple hash-based proof, whose size
is linear in the batch size, is optimal. However, as batch sizes
increase and bandwidth becomes a constraint, the constant or
near-constant size proofs generated by ZK systems become more
advantageous.

Different proof systems offer different trade-offs. The properties are:
proving effort, necessity of trusted setup, generality of trusted setup,
interactivity, proof recursion-friendliness, and of course properties
like availability of tooling, maturity, trustworthiness. Some, like
STARKs, are relatively fast to prove but have fairly large proofs; and
avoid undesirable properties such as trusted setup. Others, like
Groth16, produce small proofs but require more proving effort and a
circuit-specific trusted setup. For more complex applications, hybrid
approaches and proof recursion can be employed.
Figure [6](#fig:comp){reference-type="ref" reference="fig:comp"}
illustrates the proof size trade-off.

<figure id="fig:comp" data-latex-placement="!htbp">

<figcaption>Proof size vs. use of ZK compression. Dotted line is
bandwidth limit, dashed line is compute limit (ZK scheme specific). Not
to scale.</figcaption>
</figure>

[^1]: Assuming no centrally controlled, non-transparent technologies
    such as trusted hardware wallets or Trusted Execution Environments
    (TEEs); and that anyone can be a recipient

[^2]: Permanent from the perspective of a token, meaning for a duration
    exceeding the token's lifetime.

[^3]: Previously obtained Root of Trust is used to validate future
    transactions

[^4]: <https://docs.succinct.xyz/docs/sp1/introduction>

[^5]: <https://github.com/Okm165/sp1-poseidon2/pull/8>

[^6]: See e.g.
    <https://github.com/iden3/circomlib/blob/master/circuits/sha256/sha256.circom>

[^7]: <https://github.com/Plonky3/Plonky3>

[^8]: <https://github.com/starkware-libs/stwo>

[^9]: Experiment with iterative hashing and a hash-based signature
    scheme <https://github.com/han0110/hash-sig-agg/>
