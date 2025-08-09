document.addEventListener("DOMContentLoaded", () => {
    const modeSelection = document.getElementById("mode-selection");
    const pvpBtn = document.getElementById("pvp-btn");
    const aiBtn = document.getElementById("ai-btn");
    const gameContainer = document.getElementById("game-container");
    const boardElement = document.getElementById("board");
    const statusText = document.getElementById("status");
    const restartBtn = document.getElementById("restart-btn");

    let board = ["", "", "", "", "", "", "", "", ""];
    let currentPlayer = "";
    let gameActive = false;
    let vsAI = false;

    const winPatterns = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6]
    ];

    function startGame(aiMode) {
        vsAI = aiMode;
        board = ["", "", "", "", "", "", "", "", ""];
        gameActive = true;
        currentPlayer = Math.random() < 0.5 ? "X" : "O";
        boardElement.innerHTML = "";
        statusText.textContent = `${currentPlayer}'s turn`;

        for (let i = 0; i < 9; i++) {
            const cell = document.createElement("div");
            cell.classList.add("cell");
            cell.dataset.index = i;
            cell.addEventListener("click", handleCellClick);
            boardElement.appendChild(cell);
        }
    }

    function handleCellClick(e) {
        const index = e.target.dataset.index;
        if (board[index] !== "" || !gameActive) return;

        makeMove(index, currentPlayer);

        if (vsAI && gameActive && currentPlayer === "O") {
            setTimeout(aiMove, 500); // AI "thinking"
        }
    }

    function makeMove(index, player) {
        board[index] = player;
        const cell = boardElement.children[index];
        cell.textContent = player;
        cell.classList.add("taken");

        if (checkWin(player)) {
            statusText.textContent = `${player} wins!`;
            gameActive = false;
            highlightWin(player);
            return;
        }

        if (board.every(cell => cell !== "")) {
            statusText.textContent = "It's a draw!";
            gameActive = false;
            return;
        }

        currentPlayer = player === "X" ? "O" : "X";
        statusText.textContent = `${currentPlayer}'s turn`;
    }

    function checkWin(player) {
        return winPatterns.some(pattern =>
            pattern.every(index => board[index] === player)
        );
    }

    function highlightWin(player) {
        winPatterns.forEach(pattern => {
            if (pattern.every(index => board[index] === player)) {
                pattern.forEach(index => {
                    boardElement.children[index].classList.add("win");
                });
            }
        });
    }

    function aiMove() {
        const availableCells = board
            .map((val, i) => val === "" ? i : null)
            .filter(i => i !== null);

        if (availableCells.length === 0) return;

        const randomIndex = availableCells[Math.floor(Math.random() * availableCells.length)];
        makeMove(randomIndex, "O");
    }

    pvpBtn.addEventListener("click", () => {
        modeSelection.classList.add("hidden");
        gameContainer.classList.remove("hidden");
        startGame(false);
    });

    aiBtn.addEventListener("click", () => {
        modeSelection.classList.add("hidden");
        gameContainer.classList.remove("hidden");
        startGame(true);
    });

    restartBtn.addEventListener("click", () => {
        startGame(vsAI);
    });
});
