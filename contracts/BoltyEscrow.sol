// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title BoltyEscrow
 * @notice Holds ETH or BOLTY (ERC-20) on Base network in escrow for
 *         marketplace purchases, with different platform fees per token.
 *
 *  Base network (chainId 8453) is the only supported chain. Two payment
 *  methods:
 *    1. ETH on Base — 7% platform fee.
 *    2. BOLTY on Base — 3% platform fee (cheaper; we want to incentivize it).
 *
 *  Flow:
 *    1. Buyer calls depositETH(orderId, seller) with ETH, or depositBOLTY
 *       after approving the contract to pull the BOLTY amount.
 *    2. Seller delivers off-chain; buyer calls release(orderId).
 *    3. Contract sends (100 - feeBps/100)% to seller + feeBps/100% to platform.
 *    4. Either party can dispute(); admin resolves via resolve().
 *    5. Auto-release after RELEASE_TIMEOUT if no dispute.
 */

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract BoltyEscrow {
    // ─── State ──────────────────────────────────────────────────────────
    address public admin;
    address public platformWallet;
    address public immutable boltyToken;             // legacy BOLTY (Base ERC-20, deprecated — new token launching on Solana) on Base

    uint256 public constant PLATFORM_FEE_BPS_ETH   = 700; // 7.0 %
    uint256 public constant PLATFORM_FEE_BPS_BOLTY = 300; // 3.0 %
    uint256 public constant RELEASE_TIMEOUT        = 14 days;

    enum Status  { NONE, FUNDED, RELEASED, DISPUTED, RESOLVED, REFUNDED }
    enum PayToken { ETH, BOLTY }

    struct Order {
        address  buyer;
        address  seller;
        uint256  amount;       // total units deposited (wei for ETH, 1e18 BOLTY units)
        uint256  createdAt;
        PayToken token;        // ETH or BOLTY
        Status   status;
    }

    mapping(string => Order) public orders; // orderId (cuid from DB) → Order

    // ─── Events ─────────────────────────────────────────────────────────
    event Deposited(
        string indexed orderId,
        address buyer,
        address seller,
        uint256 amount,
        PayToken token
    );
    event Released(
        string indexed orderId,
        address seller,
        uint256 sellerAmount,
        uint256 platformFee,
        PayToken token
    );
    event Disputed(string indexed orderId, address disputedBy);
    event Resolved(string indexed orderId, bool refundedBuyer, uint256 amount, PayToken token);

    // ─── Modifiers ──────────────────────────────────────────────────────
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    // ─── Constructor ────────────────────────────────────────────────────
    constructor(address _platformWallet, address _boltyToken) {
        require(_platformWallet != address(0), "Invalid platform wallet");
        require(_boltyToken != address(0), "Invalid HAGGL token");
        admin = msg.sender;
        platformWallet = _platformWallet;
        boltyToken = _boltyToken;
    }

    // ─── Core functions ─────────────────────────────────────────────────

    /**
     * @notice Buyer deposits ETH for a specific order. 7% platform fee on release.
     */
    function depositETH(string calldata orderId, address seller) external payable {
        require(msg.value > 0, "Must send ETH");
        require(seller != address(0), "Invalid seller");
        require(seller != msg.sender, "Cannot escrow to yourself");
        require(orders[orderId].status == Status.NONE, "Order already exists");

        orders[orderId] = Order({
            buyer: msg.sender,
            seller: seller,
            amount: msg.value,
            createdAt: block.timestamp,
            token: PayToken.ETH,
            status: Status.FUNDED
        });

        emit Deposited(orderId, msg.sender, seller, msg.value, PayToken.ETH);
    }

    /**
     * @notice Buyer deposits BOLTY for a specific order. 3% platform fee on release.
     *         Buyer must have called `approve(escrow, amount)` on the HAGGL token first.
     */
    function depositBOLTY(string calldata orderId, address seller, uint256 amount) external {
        require(amount > 0, "Must send BOLTY");
        require(seller != address(0), "Invalid seller");
        require(seller != msg.sender, "Cannot escrow to yourself");
        require(orders[orderId].status == Status.NONE, "Order already exists");

        bool ok = IERC20(boltyToken).transferFrom(msg.sender, address(this), amount);
        require(ok, "BOLTY transferFrom failed");

        orders[orderId] = Order({
            buyer: msg.sender,
            seller: seller,
            amount: amount,
            createdAt: block.timestamp,
            token: PayToken.BOLTY,
            status: Status.FUNDED
        });

        emit Deposited(orderId, msg.sender, seller, amount, PayToken.BOLTY);
    }

    /**
     * @notice Buyer releases funds to seller (confirms delivery).
     *         Also callable by anyone after RELEASE_TIMEOUT with no dispute.
     */
    function release(string calldata orderId) external {
        Order storage o = orders[orderId];
        require(o.status == Status.FUNDED, "Not in funded state");
        require(
            msg.sender == o.buyer ||
            block.timestamp >= o.createdAt + RELEASE_TIMEOUT,
            "Only buyer or after timeout"
        );

        o.status = Status.RELEASED;

        uint256 bps = o.token == PayToken.ETH ? PLATFORM_FEE_BPS_ETH : PLATFORM_FEE_BPS_BOLTY;
        uint256 platformFee = (o.amount * bps) / 10000;
        uint256 sellerAmount = o.amount - platformFee;

        _payOut(o.token, o.seller, sellerAmount, platformFee);

        emit Released(orderId, o.seller, sellerAmount, platformFee, o.token);
    }

    /**
     * @notice Either buyer or seller can open a dispute.
     */
    function dispute(string calldata orderId) external {
        Order storage o = orders[orderId];
        require(o.status == Status.FUNDED, "Not in funded state");
        require(msg.sender == o.buyer || msg.sender == o.seller, "Not a party");

        o.status = Status.DISPUTED;
        emit Disputed(orderId, msg.sender);
    }

    /**
     * @notice Admin resolves a dispute: refund buyer OR pay seller.
     */
    function resolve(string calldata orderId, bool refundBuyer) external onlyAdmin {
        Order storage o = orders[orderId];
        require(o.status == Status.DISPUTED, "Not in disputed state");

        if (refundBuyer) {
            o.status = Status.REFUNDED;
            _transferOut(o.token, o.buyer, o.amount);
            emit Resolved(orderId, true, o.amount, o.token);
        } else {
            o.status = Status.RESOLVED;
            uint256 bps = o.token == PayToken.ETH ? PLATFORM_FEE_BPS_ETH : PLATFORM_FEE_BPS_BOLTY;
            uint256 platformFee = (o.amount * bps) / 10000;
            uint256 sellerAmount = o.amount - platformFee;
            _payOut(o.token, o.seller, sellerAmount, platformFee);
            emit Resolved(orderId, false, sellerAmount, o.token);
        }
    }

    // ─── Internal payout helpers ────────────────────────────────────────

    function _payOut(
        PayToken token,
        address seller,
        uint256 sellerAmount,
        uint256 platformFee
    ) private {
        _transferOut(token, seller, sellerAmount);
        if (platformFee > 0) {
            _transferOut(token, platformWallet, platformFee);
        }
    }

    function _transferOut(PayToken token, address to, uint256 amount) private {
        if (token == PayToken.ETH) {
            (bool ok,) = to.call{value: amount}("");
            require(ok, "ETH transfer failed");
        } else {
            bool ok = IERC20(boltyToken).transfer(to, amount);
            require(ok, "BOLTY transfer failed");
        }
    }

    // ─── View helpers ───────────────────────────────────────────────────

    function getOrder(string calldata orderId)
        external view
        returns (
            address buyer,
            address seller,
            uint256 amount,
            uint256 createdAt,
            PayToken token,
            Status status
        )
    {
        Order storage o = orders[orderId];
        return (o.buyer, o.seller, o.amount, o.createdAt, o.token, o.status);
    }

    function isReleasable(string calldata orderId) external view returns (bool) {
        Order storage o = orders[orderId];
        return o.status == Status.FUNDED && block.timestamp >= o.createdAt + RELEASE_TIMEOUT;
    }

    // ─── Admin ──────────────────────────────────────────────────────────

    function updateAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Invalid address");
        admin = newAdmin;
    }

    function updatePlatformWallet(address newWallet) external onlyAdmin {
        require(newWallet != address(0), "Invalid address");
        platformWallet = newWallet;
    }
}
