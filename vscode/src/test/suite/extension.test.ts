import * as assert from 'assert';
import * as vscode from 'vscode';
import { HaystackProvider } from '../../core/HaystackProvider';

export function runTests() {
    suite('Haystack Search Tests', () => {
        let haystackProvider: HaystackProvider;

        setup(() => {
            haystackProvider = new HaystackProvider(null);
        });

        test('should return search results for a valid query', async () => {
            const query = 'test';
            const results = await haystackProvider.search(query, {
                maxResults: 10,
                maxResultsPerFile: 10
            });

            assert.ok(results.results.length > 0, 'Expected search results to be returned');
        });

        test('should return no results for an invalid query', async () => {
            const query = 'nonexistentquery';
            const results = await haystackProvider.search(query, {
                maxResults: 10,
                maxResultsPerFile: 10
            });

            assert.strictEqual(results.results.length, 0, 'Expected no search results for invalid query');
        });

        // Additional tests can be added here
    });
}
