(function() {
    // VS Code API
    const vscode = acquireVsCodeApi();
    let isSearching = false; // Add a flag to track search status

    // Search function
    function performSearch() {
        // Ignore if a search is already in progress
        if (isSearching) {
            return;
        }
        isSearching = true; // Set searching flag

        const query = document.getElementById('searchInput').value;
        if (!query) {
            isSearching = false; // Reset flag if query is empty
            return;
        }

        // Clear previous results and show spinner
        const container = document.getElementById('searchResults');
        if (container) {
            container.innerHTML = '<div class="loading-spinner"></div>';
        }

        const options = {
            caseSensitive: document.getElementById('caseSensitiveBtn').classList.contains('active'),
            include: document.getElementById('includeFiles').value,
            exclude: document.getElementById('excludeFiles').value
        };

        vscode.postMessage({
            type: 'search',
            query: query,
            options: options
        });
    }

    // Display results function
    function displayResults(message) {
        isSearching = false; // Reset searching flag when results are received

        const container = document.getElementById('searchResults');
        if (!container) return;

        // Clear the container (remove spinner or previous results)
        container.innerHTML = '';

        const results = message.results;

        if (!results || results.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.className = 'search-summary';
            emptyMessage.textContent = 'No results found';
            container.appendChild(emptyMessage);
            return;
        }

        const totalMatches = results.reduce((sum, result) => sum + (result.lines?.length || 0), 0);
        const summary = document.createElement('div');
        summary.className = 'search-summary';

        if (message.truncated) {
            summary.textContent = `${totalMatches} results in ${results.length} files (Results truncated, showing partial matches)`;
        } else {
            summary.textContent = `${totalMatches} results in ${results.length} files`;
        }
        container.appendChild(summary);

        results.forEach(result => {
            const fileGroup = document.createElement('div');
            fileGroup.className = 'file-group';

            const fileHeader = document.createElement('div');
            fileHeader.className = 'file-header';
            fileHeader.innerHTML = `
                <span class="file-path">${result.file}${result.truncate ? ' (truncated)' : ''}</span>
                <span class="match-count">${result.lines?.length || 0}</span>
            `;
            fileGroup.appendChild(fileHeader);

            if (result.lines) {
                result.lines.forEach(match => {
                    const matchDiv = document.createElement('div');
                    matchDiv.className = 'result-item';

                    const lineNumberSpan = document.createElement('span');
                    lineNumberSpan.className = 'line-number';
                    lineNumberSpan.textContent = match.line.line_number.toString();

                    const lineContentSpan = document.createElement('span');
                    lineContentSpan.className = 'line-content';

                    let content = match.line.content;
                    let highlightedContent = '';

                    const matchPositions = match.line.match || [];
                    if (matchPositions.length >= 2) {
                        const start = matchPositions[0];
                        const end = matchPositions[1];

                        const beforeMatch = content.substring(0, start);
                        const truncatedBefore = beforeMatch.length > 24
                            ? '...' + beforeMatch.substring(beforeMatch.length - 24)
                            : beforeMatch;

                        highlightedContent += truncatedBefore;
                        highlightedContent += `<span class="match-highlight">${content.substring(start, end)}</span>`;

                        const afterMatch = content.substring(end);
                        const truncatedAfter = afterMatch.length > 128
                            ? afterMatch.substring(0, 128) + '...'
                            : afterMatch;
                        highlightedContent += truncatedAfter;

                        matchDiv.dataset.start = start;
                        matchDiv.dataset.end = end;
                    } else {
                        highlightedContent = content.length > 160
                            ? content.substring(0, 160) + '...'
                            : content;
                    }

                    lineContentSpan.innerHTML = highlightedContent;

                    matchDiv.appendChild(lineNumberSpan);
                    matchDiv.appendChild(lineContentSpan);

                    matchDiv.addEventListener('click', () => {
                        vscode.postMessage({
                            type: 'openFile',
                            file: result.file,
                            line: match.line.line_number,
                            start: matchDiv.dataset.start ? parseInt(matchDiv.dataset.start) : undefined,
                            end: matchDiv.dataset.end ? parseInt(matchDiv.dataset.end) : undefined
                        });
                    });
                    fileGroup.appendChild(matchDiv);
                });
            }

            container.appendChild(fileGroup);
        });
    }

    // Set up direct event listeners

    // Search input Enter key handler
    var searchInput = document.getElementById('searchInput');
    var clearTextBtn = document.getElementById('clearTextBtn');

    if (searchInput) {
        // Handle input changes to show/hide clear button
        searchInput.addEventListener('input', function() {
            if (clearTextBtn) {
                clearTextBtn.style.display = this.value ? 'flex' : 'none';
            }
        });

        searchInput.onkeydown = function(e) {
            if (e.key === 'Enter' || e.keyCode === 13) {
                performSearch();
                return false;
            }
        };
    }

    // Clear text button handler
    if (clearTextBtn) {
        clearTextBtn.onclick = function() {
            if (searchInput) {
                searchInput.value = '';
                this.style.display = 'none';
                // Focus the search input
                searchInput.focus();
                // Clear the search results
                const resultsContainer = document.getElementById('searchResults');
                if (resultsContainer) {
                    resultsContainer.innerHTML = '';
                }
            }
        };
    }

    // Include files Enter key handler
    var includeFiles = document.getElementById('includeFiles');
    if (includeFiles) {
        includeFiles.onkeydown = function(e) {
            if (e.key === 'Enter' || e.keyCode === 13) {
                performSearch();
                return false;
            }
        };
    }

    // Exclude files Enter key handler
    var excludeFiles = document.getElementById('excludeFiles');
    if (excludeFiles) {
        excludeFiles.onkeydown = function(e) {
            if (e.key === 'Enter' || e.keyCode === 13) {
                performSearch();
                return false;
            }
        };
    }

    // Case sensitive button click handler
    var caseSensitiveBtn = document.getElementById('caseSensitiveBtn');
    if (caseSensitiveBtn) {
        caseSensitiveBtn.onclick = function() {
            this.classList.toggle('active');
            if (searchInput && searchInput.value.trim()) {
                performSearch();
            }
        };
    }

    // Options toggle button click handler
    var optionsToggle = document.getElementById('optionsToggle');
    if (optionsToggle) {
        optionsToggle.onclick = function() {
            var options = document.getElementById('searchOptions');
            if (options) {
                options.classList.toggle('visible');
                this.classList.toggle('active');
            }
        };
    }

    var focusSearchInput = () => {
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.focus();
            searchInput.select(); // Also select the text for easy replacement
        }
    }

    // DOM Content Loaded event handler
    document.addEventListener('DOMContentLoaded', function() {
        // Notify VS Code that the DOM has been loaded
        vscode.postMessage({
            type: 'domLoaded'
        });

        // Initialize the clear button state
        const searchInput = document.getElementById('searchInput');
        const clearTextBtn = document.getElementById('clearTextBtn');
        if (searchInput && clearTextBtn) {
            clearTextBtn.style.display = searchInput.value ? 'flex' : 'none';
        }

        // Auto focus the search input when the DOM loads
        focusSearchInput();
    });

    // Message handler
    window.addEventListener('message', function(event) {
        var message = event.data;
        if (message.type === 'searchResults') {
            displayResults(message);
        } else if (message.type === 'setSearchText') {
            // Handle setting search text from editor selection
            const searchInput = document.getElementById('searchInput');
            const clearTextBtn = document.getElementById('clearTextBtn');
            if (searchInput && message.text) {
                searchInput.value = message.text;
                // Show clear button when text is set
                if (clearTextBtn) {
                    clearTextBtn.style.display = message.text ? 'flex' : 'none';
                }
                // Perform search immediately with the new text
                performSearch();
                focusSearchInput();
            }
        } else if (message.type === 'focusSearchInput') {
            // Handle focusing the search input
            focusSearchInput();
        } else if (message.type === 'visibilityChanged') {
            // Handle visibility change events
            console.log(`WebView visibility changed: ${message.isVisible ? 'visible' : 'hidden'}`);
            if (message.isVisible) {
                focusSearchInput();

                const searchInput = document.getElementById('searchInput');
                const resultsContainer = document.getElementById('searchResults');
                if (searchInput && searchInput.value.trim() && resultsContainer && !resultsContainer.hasChildNodes()) {
                    performSearch();
                }
            }
        }
    });
})();
