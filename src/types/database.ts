export type TournamentStatus = 'waiting_users' | 'creating_cards' | 'playing' | 'final_tiebreaker' | 'finished'
export type TournamentMode = 'solo' | 'test' | 'production'
export type GameStatus = 'waiting_submission' | 'waiting_vote' | 'waiting_tiebreaker_vote' | 'waiting_button_mash' | 'showing_result' | 'showing_rematch' | 'finished'
export type TiebreakerMode = 'vote' | 'button_mash'
export type CardPosition = 'before' | 'after'

export type Database = {
  public: {
    Tables: {
      tournaments: {
        Row: {
          id: string
          token: string
          mode: TournamentMode
          required_players: number
          game_count: number
          cards_per_user: number
          hand_cards_per_player: number
          dirty_cards_per_user: number
          skip_card_creation: boolean
          secret_voting: boolean
          secret_round: number | null
          impersonation_mode: boolean
          random_voting: boolean
          tiebreaker_mode: TiebreakerMode
          status: TournamentStatus
          created_at: string
        }
        Insert: {
          id?: string
          token: string
          mode?: TournamentMode
          required_players?: number
          game_count?: number
          cards_per_user?: number
          hand_cards_per_player?: number
          dirty_cards_per_user?: number
          skip_card_creation?: boolean
          secret_voting?: boolean
          secret_round?: number | null
          impersonation_mode?: boolean
          random_voting?: boolean
          tiebreaker_mode?: TiebreakerMode
          status?: TournamentStatus
          created_at?: string
        }
        Update: {
          id?: string
          token?: string
          mode?: TournamentMode
          required_players?: number
          game_count?: number
          cards_per_user?: number
          hand_cards_per_player?: number
          dirty_cards_per_user?: number
          skip_card_creation?: boolean
          secret_voting?: boolean
          secret_round?: number | null
          impersonation_mode?: boolean
          random_voting?: boolean
          tiebreaker_mode?: TiebreakerMode
          status?: TournamentStatus
          created_at?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          id: string
          name: string
          line_user_id: string | null
        }
        Insert: {
          id?: string
          name: string
          line_user_id?: string | null
        }
        Update: {
          id?: string
          name?: string
          line_user_id?: string | null
        }
        Relationships: []
      }
      tournament_participants: {
        Row: {
          id: string
          tournament_id: string
          user_id: string
          joined_at: string
        }
        Insert: {
          id?: string
          tournament_id: string
          user_id: string
          joined_at?: string
        }
        Update: {
          id?: string
          tournament_id?: string
          user_id?: string
          joined_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tournament_participants_tournament_id_fkey'
            columns: ['tournament_id']
            referencedRelation: 'tournaments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tournament_participants_user_id_fkey'
            columns: ['user_id']
            referencedRelation: 'users'
            referencedColumns: ['id']
          }
        ]
      }
      cards: {
        Row: {
          id: string
          tournament_id: string
          creator_user_id: string
          text: string
          is_dirty: boolean
          created_at: string
        }
        Insert: {
          id?: string
          tournament_id: string
          creator_user_id: string
          text: string
          is_dirty?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          tournament_id?: string
          creator_user_id?: string
          text?: string
          is_dirty?: boolean
          created_at?: string
        }
        Relationships: []
      }
      player_hands: {
        Row: {
          id: string
          tournament_id: string
          user_id: string
          card_id: string
          is_used: boolean
        }
        Insert: {
          id?: string
          tournament_id: string
          user_id: string
          card_id: string
          is_used?: boolean
        }
        Update: {
          id?: string
          tournament_id?: string
          user_id?: string
          card_id?: string
          is_used?: boolean
        }
        Relationships: []
      }
      games: {
        Row: {
          id: string
          tournament_id: string
          round_number: number
          status: GameStatus
          topic_card_id: string
          is_rematch: boolean
          voting_mode: string | null
          created_at: string
        }
        Insert: {
          id?: string
          tournament_id: string
          round_number: number
          status?: GameStatus
          topic_card_id: string
          is_rematch?: boolean
          voting_mode?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          tournament_id?: string
          round_number?: number
          status?: GameStatus
          topic_card_id?: string
          is_rematch?: boolean
          voting_mode?: string | null
          created_at?: string
        }
        Relationships: []
      }
      submissions: {
        Row: {
          id: string
          game_id: string
          user_id: string
          hand_card_id: string
          position: CardPosition
          preamble: string | null
          preamble_position: 'above' | 'below'
          impersonated_user_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          game_id: string
          user_id: string
          hand_card_id: string
          position: CardPosition
          preamble?: string | null
          preamble_position?: 'above' | 'below'
          impersonated_user_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          game_id?: string
          user_id?: string
          hand_card_id?: string
          position?: CardPosition
          preamble?: string | null
          preamble_position?: 'above' | 'below'
          impersonated_user_id?: string | null
          created_at?: string
        }
        Relationships: []
      }
      votes: {
        Row: {
          id: string
          game_id: string
          voter_user_id: string
          submission_id: string
          is_tiebreaker: boolean
          created_at: string
        }
        Insert: {
          id?: string
          game_id: string
          voter_user_id: string
          submission_id: string
          is_tiebreaker?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          game_id?: string
          voter_user_id?: string
          submission_id?: string
          is_tiebreaker?: boolean
          created_at?: string
        }
        Relationships: []
      }
      user_ai_comments: {
        Row: {
          id: string
          user_id: string
          overall_comment: string | null
          last_tournament_comment: string | null
          card_analysis_comment: string | null
          nickname: string | null
          last_tournament_id: string | null
          tournament_count: number
          generated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          overall_comment?: string | null
          last_tournament_comment?: string | null
          card_analysis_comment?: string | null
          nickname?: string | null
          last_tournament_id?: string | null
          tournament_count: number
          generated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          overall_comment?: string | null
          last_tournament_comment?: string | null
          card_analysis_comment?: string | null
          nickname?: string | null
          last_tournament_id?: string | null
          tournament_count?: number
          generated_at?: string
        }
        Relationships: []
      }
      button_mash_results: {
        Row: {
          id: string
          game_id: string
          user_id: string
          tap_count: number
          mash_round: number
          completed_at: string
        }
        Insert: {
          id?: string
          game_id: string
          user_id: string
          tap_count: number
          mash_round?: number
          completed_at?: string
        }
        Update: {
          id?: string
          game_id?: string
          user_id?: string
          tap_count?: number
          mash_round?: number
          completed_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
